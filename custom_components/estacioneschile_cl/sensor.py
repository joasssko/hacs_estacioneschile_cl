"""Sensor platform for Estaciones y Servicios Chile integration."""
from __future__ import annotations

import math
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    DOMAIN,
    CONF_TANK_CAPACITY,
    CONF_PREFERRED_FUEL,
    CONF_STATION_COUNT,
    DEFAULT_TANK_CAPACITY,
    DEFAULT_PREFERRED_FUEL,
    DEFAULT_STATION_COUNT,
    PRODUCT_CODES,
    SERVICES_COPEC,
    SERVICES_OTHER,
)


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in km using Haversine formula."""
    try:
        lat1, lon1, lat2, lon2 = map(float, [lat1, lon1, lat2, lon2])
    except (ValueError, TypeError):
        return float("inf")

    R = 6371.0  # Radius of earth in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 2)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the sensor platform from a config entry."""
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([EstacionesChileSensor(coordinator, entry)])


class EstacionesChileSensor(CoordinatorEntity, SensorEntity):
    """Representation of a Estaciones y Servicios Chile Sensor."""

    _attr_icon = "mdi:gas-station"

    def __init__(self, coordinator, entry: ConfigEntry) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._entry = entry
        self._attr_name = "Estaciones Chile Más Cercanas"
        self._attr_unique_id = f"{DOMAIN}_closest_stations"

    @property
    def native_value(self) -> Any:
        """Return the state of the sensor."""
        stations = self.extra_state_attributes.get("stations", [])
        if not stations:
            return None

        # Get preferred fuel from options or config
        preferred_fuel = self._entry.options.get(
            CONF_PREFERRED_FUEL,
            self._entry.data.get(CONF_PREFERRED_FUEL, DEFAULT_PREFERRED_FUEL)
        )

        if preferred_fuel != "Ninguno":
            # State is the price of preferred fuel at the closest station
            # that has this fuel type available
            for station in stations:
                prices = station.get("prices", {})
                if preferred_fuel in prices:
                    return prices[preferred_fuel]
            return None

        # If no preferred fuel, return the distance of the closest station
        return stations[0].get("distance")

    @property
    def native_unit_of_measurement(self) -> str | None:
        """Return the unit of measurement."""
        preferred_fuel = self._entry.options.get(
            CONF_PREFERRED_FUEL,
            self._entry.data.get(CONF_PREFERRED_FUEL, DEFAULT_PREFERRED_FUEL)
        )
        if preferred_fuel != "Ninguno":
            return "CLP"
        return "km"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return entity specific state attributes."""
        if not self.coordinator.data:
            return {}

        # Resolve home location
        home_lat = None
        home_lon = None

        # 1. Try zone.home
        zone_home = self.hass.states.get("zone.home")
        if zone_home:
            home_lat = zone_home.attributes.get("latitude")
            home_lon = zone_home.attributes.get("longitude")

        # 2. Fallback to hass config
        if home_lat is None or home_lon is None:
            home_lat = self.hass.config.latitude
            home_lon = self.hass.config.longitude

        # 3. Last fallback: Santiago coordinates if none are set
        if home_lat is None or home_lon is None:
            home_lat = -33.4489
            home_lon = -70.6693

        # Resolve config preferences
        tank_capacity = self._entry.options.get(
            CONF_TANK_CAPACITY,
            self._entry.data.get(CONF_TANK_CAPACITY, DEFAULT_TANK_CAPACITY)
        )
        preferred_fuel = self._entry.options.get(
            CONF_PREFERRED_FUEL,
            self._entry.data.get(CONF_PREFERRED_FUEL, DEFAULT_PREFERRED_FUEL)
        )
        station_count = self._entry.options.get(
            CONF_STATION_COUNT,
            self._entry.data.get(CONF_STATION_COUNT, DEFAULT_STATION_COUNT)
        )

        processed_stations = []

        for station in self.coordinator.data:
            lat = station.get("Latitud")
            lon = station.get("Longitud")
            if not lat or not lon:
                continue

            # Calculate distance
            dist = calculate_distance(home_lat, home_lon, lat, lon)

            # Parse prices
            prices_raw = station.get("Prices", [])
            prices = {}
            for p in prices_raw:
                cod_pro = str(p.get("CodPro"))
                fuel_key = PRODUCT_CODES.get(cod_pro)
                if fuel_key:
                    try:
                        prices[fuel_key] = int(p.get("Precio"))
                    except (ValueError, TypeError):
                        pass

            # Parse services
            servicios_obj = station.get("Servicios", {})
            cod_ser = servicios_obj.get("CodSer", [])
            company = station.get("Compania", "").upper()
            services_list = []

            service_map = SERVICES_COPEC if "COPEC" in company else SERVICES_OTHER
            for s_code in cod_ser:
                s_code_str = str(s_code)
                if s_code_str in service_map:
                    services_list.append(service_map[s_code_str])

            # Calculate price to full tank for this station
            price_to_full = None
            pref_price = None
            if preferred_fuel != "Ninguno" and preferred_fuel in prices:
                pref_price = prices[preferred_fuel]
                price_to_full = round(pref_price * tank_capacity, 0)

            processed_stations.append({
                "id": station.get("CodEs"),
                "company": station.get("Compania", "Copec"),
                "comuna": station.get("Comuna"),
                "address": station.get("Direccion"),
                "latitude": float(lat),
                "longitude": float(lon),
                "distance": dist,
                "prices": prices,
                "services": services_list,
                "preferred_fuel_price": pref_price,
                "price_to_full_tank": price_to_full,
                "type": station.get("Tipo"),
            })

        # Sort by distance
        processed_stations.sort(key=lambda x: x["distance"])

        # Take closest
        closest_stations = processed_stations[:station_count]

        # Find cheapest station for preferred fuel (if configured)
        cheapest_station = None
        if preferred_fuel != "Ninguno":
            valid_stations = [s for s in closest_stations if preferred_fuel in s["prices"]]
            if valid_stations:
                cheapest_station = min(valid_stations, key=lambda x: x["prices"][preferred_fuel])

        return {
            "tank_capacity": tank_capacity,
            "preferred_fuel": preferred_fuel,
            "home_latitude": home_lat,
            "home_longitude": home_lon,
            "stations": closest_stations,
            "cheapest_station": cheapest_station,
        }
