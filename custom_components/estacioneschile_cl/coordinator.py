"""Data coordinator for Estaciones y Servicios Chile."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import timedelta
import math
from typing import Any

from aiohttp import ClientError

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    API_URL,
    CONF_COMPANIES,
    CONF_CONSUMPTION,
    CONF_PREFERRED_FUEL,
    CONF_STATION_COUNT,
    CONF_TANK_CAPACITY,
    DEFAULT_CONSUMPTION,
    DEFAULT_PREFERRED_FUEL,
    DEFAULT_STATION_COUNT,
    DEFAULT_TANK_CAPACITY,
    DOMAIN,
    LOGGER,
    NO_FUEL,
    PRODUCT_CODES,
    SERVICES_COPEC,
    SERVICES_OTHER,
    UPDATE_INTERVAL_MINUTES,
    VERSION,
)

SANTIAGO = (-33.4489, -70.6693)

type EstacionesChileConfigEntry = ConfigEntry[EstacionesChileCoordinator]


@dataclass(slots=True)
class EstacionesData:
    """Processed data shared by every platform."""

    home: tuple[float, float]
    preferred_fuel: str
    tank_capacity: float
    consumption: float = DEFAULT_CONSUMPTION
    # Preferred companies (empty = all)
    companies: list[str] = field(default_factory=list)
    # Closest stations of the preferred companies, sorted by distance,
    # with "savings" for the preferred fuel (already in the attribute format)
    stations: list[dict[str, Any]] = field(default_factory=list)
    # Closest stations of every company (only differs when a filter is set)
    all_stations: list[dict[str, Any]] = field(default_factory=list)
    # Cheapest station among the closest ones, per fuel type
    cheapest: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Station with the highest net saving for the preferred fuel
    best_saving: dict[str, Any] | None = None


def calculate_savings(
    stations: list[dict[str, Any]], fuel: str, tank_capacity: float, consumption: float
) -> dict[str, int | None]:
    """Net saving of filling the tank at each station instead of the closest one.

    The reference is the closest station that sells the fuel. Going further costs
    the extra round trip from home (straight-line distance) at that station's price:

        saving = (ref_price - price) * tank - 2 * (distance - ref_distance) / km_per_l * price
    """
    savings: dict[str, int | None] = {s["id"]: None for s in stations}
    selling = [s for s in stations if fuel in s["prices"]]
    if not selling or consumption <= 0:
        return savings
    ref = min(selling, key=lambda s: s["distance"])
    ref_price = ref["prices"][fuel]
    for station in selling:
        price = station["prices"][fuel]
        extra_km = 2 * max(0.0, station["distance"] - ref["distance"])
        travel_cost = extra_km / consumption * price
        savings[station["id"]] = round((ref_price - price) * tank_capacity - travel_cost)
    return savings


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in km using Haversine formula."""
    try:
        lat1, lon1, lat2, lon2 = map(float, [lat1, lon1, lat2, lon2])
    except (ValueError, TypeError):
        return float("inf")

    radius = 6371.0  # Radius of earth in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(radius * c, 2)


def parse_station(
    station: dict[str, Any], dist: float, preferred_fuel: str, tank_capacity: float
) -> dict[str, Any]:
    """Convert a raw API station into the attribute format used by the card."""
    prices: dict[str, int] = {}
    for p in station.get("Prices") or []:
        fuel_key = PRODUCT_CODES.get(str(p.get("CodPro")))
        if fuel_key:
            try:
                prices[fuel_key] = int(float(p.get("Precio")))
            except (ValueError, TypeError):
                pass

    company = station.get("Compania") or "Copec"
    service_map = SERVICES_COPEC if "COPEC" in company.upper() else SERVICES_OTHER
    cod_ser = (station.get("Servicios") or {}).get("CodSer") or []
    services = [service_map[str(code)] for code in cod_ser if str(code) in service_map]

    pref_price = prices.get(preferred_fuel) if preferred_fuel != NO_FUEL else None
    price_to_full = round(pref_price * tank_capacity) if pref_price is not None else None

    return {
        "id": str(station.get("CodEs")),
        "company": company,
        "comuna": station.get("Comuna"),
        "address": station.get("Direccion"),
        "latitude": float(station["Latitud"]),
        "longitude": float(station["Longitud"]),
        "distance": dist,
        "prices": prices,
        "services": services,
        "preferred_fuel_price": pref_price,
        "price_to_full_tank": price_to_full,
        "type": station.get("Tipo"),
    }


class EstacionesChileCoordinator(DataUpdateCoordinator[EstacionesData]):
    """Fetch the Copec API and keep the closest stations."""

    config_entry: EstacionesChileConfigEntry

    def __init__(self, hass: HomeAssistant, entry: EstacionesChileConfigEntry) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=timedelta(minutes=UPDATE_INTERVAL_MINUTES),
        )
        # Every company seen in the API (used by the options flow)
        self.companies: list[str] = []
        self.device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Estaciones Chile",
            manufacturer="Copec (API pública)",
            model="Estaciones de combustible",
            entry_type=DeviceEntryType.SERVICE,
            sw_version=VERSION,
        )

    def option(self, key: str, default: Any) -> Any:
        """Return an option, falling back to the initial config data."""
        entry = self.config_entry
        return entry.options.get(key, entry.data.get(key, default))

    def _home_location(self) -> tuple[float, float]:
        """Return the home coordinates (zone.home, then core config, then Santiago)."""
        zone_home = self.hass.states.get("zone.home")
        if zone_home:
            lat = zone_home.attributes.get("latitude")
            lon = zone_home.attributes.get("longitude")
            if lat is not None and lon is not None:
                return float(lat), float(lon)
        if self.hass.config.latitude is not None and self.hass.config.longitude is not None:
            return float(self.hass.config.latitude), float(self.hass.config.longitude)
        return SANTIAGO

    async def _async_update_data(self) -> EstacionesData:
        """Fetch data from the Copec API and process it."""
        session = async_get_clientsession(self.hass)
        try:
            async with asyncio.timeout(30):
                response = await session.get(API_URL)
                if response.status != 200:
                    raise UpdateFailed(
                        f"Error fetching data from Copec API: HTTP status {response.status}"
                    )
                raw = await response.json(content_type=None)
        except (ClientError, TimeoutError, ValueError) as err:
            raise UpdateFailed(f"Error communicating with Copec API: {err}") from err

        if not isinstance(raw, list):
            raise UpdateFailed("Unexpected response format from Copec API")
        self.companies = companies_in(raw)
        return self.process(raw)

    def process(self, raw: list[dict[str, Any]]) -> EstacionesData:
        """Keep the closest stations and compute the cheapest per fuel."""
        home_lat, home_lon = self._home_location()
        tank_capacity = float(self.option(CONF_TANK_CAPACITY, DEFAULT_TANK_CAPACITY))
        preferred_fuel = self.option(CONF_PREFERRED_FUEL, DEFAULT_PREFERRED_FUEL)
        station_count = int(self.option(CONF_STATION_COUNT, DEFAULT_STATION_COUNT))
        consumption = float(self.option(CONF_CONSUMPTION, DEFAULT_CONSUMPTION) or DEFAULT_CONSUMPTION)
        companies = list(self.option(CONF_COMPANIES, []) or [])
        wanted = {c.casefold() for c in companies}

        # Distances first, so the heavier parsing only runs for the closest stations
        candidates: list[tuple[float, dict[str, Any]]] = []
        for station in raw:
            lat = station.get("Latitud")
            lon = station.get("Longitud")
            if not lat or not lon:
                continue
            dist = calculate_distance(home_lat, home_lon, lat, lon)
            if dist != float("inf"):
                candidates.append((dist, station))
        candidates.sort(key=lambda item: item[0])

        all_stations = [
            parse_station(station, dist, preferred_fuel, tank_capacity)
            for dist, station in candidates[:station_count]
        ]
        if wanted:
            stations = self._filtered(
                candidates, wanted, station_count, preferred_fuel, tank_capacity
            )
        else:
            stations = [dict(s) for s in all_stations]

        savings = (
            calculate_savings(stations, preferred_fuel, tank_capacity, consumption)
            if preferred_fuel != NO_FUEL
            else {}
        )
        best_saving = None
        for station in stations:
            station["savings"] = savings.get(station["id"])
            if station["savings"] is not None and (
                best_saving is None or station["savings"] > best_saving["savings"]
            ):
                best_saving = station

        cheapest: dict[str, dict[str, Any]] = {}
        for station in stations:
            for fuel, price in station["prices"].items():
                best = cheapest.get(fuel)
                if best is None or price < best["prices"][fuel]:
                    cheapest[fuel] = station

        return EstacionesData(
            home=(home_lat, home_lon),
            preferred_fuel=preferred_fuel,
            tank_capacity=tank_capacity,
            consumption=consumption,
            companies=companies,
            stations=stations,
            all_stations=all_stations if wanted else [],
            cheapest=cheapest,
            best_saving=best_saving,
        )

    @staticmethod
    def _filtered(
        candidates: list[tuple[float, dict[str, Any]]],
        wanted: set[str],
        station_count: int,
        preferred_fuel: str,
        tank_capacity: float,
    ) -> list[dict[str, Any]]:
        """Closest stations whose company is one of the wanted ones."""
        result: list[dict[str, Any]] = []
        for dist, station in candidates:
            if str(station.get("Compania") or "").strip().casefold() in wanted:
                result.append(parse_station(station, dist, preferred_fuel, tank_capacity))
                if len(result) >= station_count:
                    break
        return result


def companies_in(raw: list[dict[str, Any]]) -> list[str]:
    """Return the distinct company names present in the API data."""
    names: dict[str, str] = {}
    for station in raw:
        name = str(station.get("Compania") or "").strip()
        if name:
            names.setdefault(name.casefold(), name)
    return sorted(names.values(), key=str.casefold)
