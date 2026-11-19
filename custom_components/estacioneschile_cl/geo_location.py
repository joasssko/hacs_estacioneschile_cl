"""Geolocation platform: one entity per nearby station.

These entities make the stations appear in Home Assistant's native map card:

    type: map
    geo_location_sources:
      - estacioneschile_cl
"""
from __future__ import annotations

from typing import Any

from homeassistant.components.geo_location import GeolocationEvent
from homeassistant.const import UnitOfLength
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import GEO_SOURCE
from .coordinator import EstacionesChileConfigEntry, EstacionesChileCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: EstacionesChileConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Create and keep in sync one geolocation entity per closest station."""
    coordinator = entry.runtime_data
    entities: dict[str, EstacionGeolocation] = {}

    @callback
    def _sync() -> None:
        stations = {s["id"]: s for s in coordinator.data.stations} if coordinator.data else {}

        # Stations that are no longer among the closest ones
        for station_id in list(entities):
            if station_id not in stations:
                hass.async_create_task(entities.pop(station_id).async_remove(force_remove=True))

        new_entities = []
        for station_id, station in stations.items():
            if station_id in entities:
                entities[station_id].update_station(station)
            else:
                entity = EstacionGeolocation(coordinator, station)
                entities[station_id] = entity
                new_entities.append(entity)
        if new_entities:
            async_add_entities(new_entities)

    _sync()
    entry.async_on_unload(coordinator.async_add_listener(_sync))



class EstacionGeolocation(GeolocationEvent):
    """A fuel station shown on the map."""

    _attr_should_poll = False
    _attr_icon = "mdi:gas-station"
    _attr_source = GEO_SOURCE
    _attr_unit_of_measurement = UnitOfLength.KILOMETERS

    def __init__(self, coordinator: EstacionesChileCoordinator, station: dict[str, Any]) -> None:
        """Initialize the entity."""
        self._coordinator = coordinator
        self._station = station
        company = station.get("company") or "Estación"
        address = station.get("address") or station["id"]
        self._attr_name = f"{company} {address}"
        self._apply(station)

    def _apply(self, station: dict[str, Any]) -> None:
        self._station = station
        self._attr_latitude = station["latitude"]
        self._attr_longitude = station["longitude"]
        self._attr_distance = station["distance"]

    @callback
    def update_station(self, station: dict[str, Any]) -> None:
        """Update with fresh data and write the state."""
        self._apply(station)
        if self.hass is not None:
            self.async_write_ha_state()

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return prices and station details."""
        station = self._station
        data = self._coordinator.data
        attrs: dict[str, Any] = {
            "station_id": station["id"],
            "company": station.get("company"),
            "address": station.get("address"),
            "comuna": station.get("comuna"),
        }
        for fuel, price in station.get("prices", {}).items():
            attrs[f"price_{fuel.lower()}"] = price
        if data and data.preferred_fuel in data.cheapest:
            attrs["cheapest_for_preferred_fuel"] = (
                data.cheapest[data.preferred_fuel]["id"] == station["id"]
            )
        return attrs
