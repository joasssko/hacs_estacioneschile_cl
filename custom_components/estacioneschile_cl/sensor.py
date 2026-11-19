"""Sensor platform for Estaciones y Servicios Chile integration."""
from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.const import UnitOfLength
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, FUEL_TYPES, FUELS_ENABLED_BY_DEFAULT, NO_FUEL
from .coordinator import EstacionesChileConfigEntry, EstacionesChileCoordinator

PRICE_UNIT = "CLP/L"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: EstacionesChileConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the sensor platform from a config entry."""
    coordinator = entry.runtime_data
    entities: list[SensorEntity] = [EstacionesChileSensor(coordinator), BestSavingSensor(coordinator)]
    entities.extend(
        CheapestFuelSensor(coordinator, fuel) for fuel in FUEL_TYPES if fuel != NO_FUEL
    )
    async_add_entities(entities)


class EstacionesChileEntity(CoordinatorEntity[EstacionesChileCoordinator]):
    """Base entity grouped under the integration device."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: EstacionesChileCoordinator) -> None:
        """Initialize the entity."""
        super().__init__(coordinator)
        self._attr_device_info = coordinator.device_info


class EstacionesChileSensor(EstacionesChileEntity, SensorEntity):
    """Closest fuel stations, with their prices and locations as attributes.

    This is the entity used by the custom Lovelace card.
    """

    _attr_icon = "mdi:gas-station"
    _attr_translation_key = "closest_stations"
    # The station list is large (it can exceed the 16 KB attribute limit of the
    # recorder) and changes every refresh: keep it out of the database.
    _unrecorded_attributes = frozenset(
        {"stations", "all_stations", "cheapest_station", "best_saving_station"}
    )

    def __init__(self, coordinator: EstacionesChileCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        # Kept from v1.0 so existing installations keep their entity
        self._attr_unique_id = f"{DOMAIN}_closest_stations"

    @property
    def native_unit_of_measurement(self) -> str | None:
        """Return the unit of measurement."""
        data = self.coordinator.data
        if data and data.preferred_fuel != NO_FUEL:
            return PRICE_UNIT
        return UnitOfLength.KILOMETERS

    @property
    def native_value(self) -> float | int | None:
        """Preferred fuel price at the closest station selling it, or distance to the closest station."""
        data = self.coordinator.data
        if not data or not data.stations:
            return None
        if data.preferred_fuel != NO_FUEL:
            return next(
                (
                    s["prices"][data.preferred_fuel]
                    for s in data.stations
                    if data.preferred_fuel in s["prices"]
                ),
                None,
            )
        return data.stations[0]["distance"]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return the stations used by the card."""
        data = self.coordinator.data
        if not data:
            return {}
        attrs = {
            "tank_capacity": data.tank_capacity,
            "consumption": data.consumption,
            "preferred_fuel": data.preferred_fuel,
            "companies": data.companies,
            "home_latitude": data.home[0],
            "home_longitude": data.home[1],
            "stations": data.stations,
            "cheapest_station": data.cheapest.get(data.preferred_fuel),
            "best_saving_station": data.best_saving,
        }
        if data.all_stations:
            # Only when a company filter is set: lets the card show "all companies"
            attrs["all_stations"] = data.all_stations
        return attrs


class CheapestFuelSensor(EstacionesChileEntity, SensorEntity):
    """Lowest price of one fuel among the closest stations."""

    _attr_icon = "mdi:gas-station-outline"
    _attr_translation_key = "cheapest_fuel"
    _attr_native_unit_of_measurement = PRICE_UNIT
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 0

    def __init__(self, coordinator: EstacionesChileCoordinator, fuel: str) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._fuel = fuel
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}_cheapest_{fuel.lower()}"
        self._attr_translation_placeholders = {"fuel": FUEL_TYPES[fuel]}
        self._attr_entity_registry_enabled_default = fuel in FUELS_ENABLED_BY_DEFAULT

    def _station(self) -> dict[str, Any] | None:
        data = self.coordinator.data
        return data.cheapest.get(self._fuel) if data else None

    @property
    def native_value(self) -> int | None:
        """Return the lowest price."""
        station = self._station()
        return station["prices"][self._fuel] if station else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return where that price is."""
        station = self._station()
        if not station:
            return {}
        data = self.coordinator.data
        return {
            "station_id": station["id"],
            "company": station.get("company"),
            "address": station.get("address"),
            "comuna": station.get("comuna"),
            "distance_km": station.get("distance"),
            "price_to_full_tank": round(station["prices"][self._fuel] * data.tank_capacity),
            # Lets the native map card show where the cheapest station is
            "latitude": station["latitude"],
            "longitude": station["longitude"],
        }


class BestSavingSensor(EstacionesChileEntity, SensorEntity):
    """Highest net saving for the preferred fuel versus the closest station."""

    _attr_icon = "mdi:piggy-bank-outline"
    _attr_translation_key = "best_saving"
    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_native_unit_of_measurement = "CLP"
    _attr_suggested_display_precision = 0

    def __init__(self, coordinator: EstacionesChileCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}_best_saving"

    @property
    def native_value(self) -> int | None:
        """Return the saving in CLP (0 when the closest station is already the best)."""
        data = self.coordinator.data
        if not data or data.best_saving is None:
            return None
        return max(0, data.best_saving["savings"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return where to go and how it was calculated."""
        data = self.coordinator.data
        if not data or data.best_saving is None:
            return {}
        best = data.best_saving
        fuel = data.preferred_fuel
        reference = min(
            (s for s in data.stations if fuel in s["prices"]), key=lambda s: s["distance"]
        )
        return {
            "fuel": fuel,
            "station_id": best["id"],
            "company": best.get("company"),
            "address": best.get("address"),
            "distance_km": best.get("distance"),
            "price": best["prices"][fuel],
            "reference_station_id": reference["id"],
            "reference_company": reference.get("company"),
            "reference_address": reference.get("address"),
            "reference_price": reference["prices"][fuel],
            "tank_capacity": data.tank_capacity,
            "consumption_km_l": data.consumption,
            "latitude": best["latitude"],
            "longitude": best["longitude"],
        }
