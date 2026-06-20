"""Config flow for Estaciones y Servicios Chile integration."""
from typing import Any
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import config_validation as cv

from .const import (
    DOMAIN,
    CONF_TANK_CAPACITY,
    CONF_PREFERRED_FUEL,
    CONF_STATION_COUNT,
    DEFAULT_TANK_CAPACITY,
    DEFAULT_PREFERRED_FUEL,
    DEFAULT_STATION_COUNT,
    FUEL_TYPES,
)


class EstacionesChileConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Estaciones y Servicios Chile."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            # We don't allow duplicate configurations to keep it simple
            await self.async_set_unique_id(DOMAIN)
            self._abort_if_unique_id_configured()

            return self.async_create_entry(
                title="Estaciones Chile",
                data=user_input,
            )

        data_schema = vol.Schema(
            {
                vol.Required(CONF_TANK_CAPACITY, default=DEFAULT_TANK_CAPACITY): vol.Coerce(float),
                vol.Required(CONF_PREFERRED_FUEL, default=DEFAULT_PREFERRED_FUEL): vol.In(list(FUEL_TYPES.keys())),
                vol.Required(CONF_STATION_COUNT, default=DEFAULT_STATION_COUNT): vol.All(
                    vol.Coerce(int), vol.Range(min=1, max=50)
                ),
            }
        )

        return self.async_show_form(
            step_id="user", data_schema=data_schema, errors=errors
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Create the options flow."""
        return EstacionesChileOptionsFlowHandler(config_entry)


class EstacionesChileOptionsFlowHandler(config_entries.OptionsFlow):
    """Handle options flow for Estaciones y Servicios Chile."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        # Get existing values, fallback to data, then defaults
        tank_capacity = self.config_entry.options.get(
            CONF_TANK_CAPACITY,
            self.config_entry.data.get(CONF_TANK_CAPACITY, DEFAULT_TANK_CAPACITY)
        )
        preferred_fuel = self.config_entry.options.get(
            CONF_PREFERRED_FUEL,
            self.config_entry.data.get(CONF_PREFERRED_FUEL, DEFAULT_PREFERRED_FUEL)
        )
        station_count = self.config_entry.options.get(
            CONF_STATION_COUNT,
            self.config_entry.data.get(CONF_STATION_COUNT, DEFAULT_STATION_COUNT)
        )

        data_schema = vol.Schema(
            {
                vol.Required(CONF_TANK_CAPACITY, default=float(tank_capacity)): vol.Coerce(float),
                vol.Required(CONF_PREFERRED_FUEL, default=preferred_fuel): vol.In(list(FUEL_TYPES.keys())),
                vol.Required(CONF_STATION_COUNT, default=int(station_count)): vol.All(
                    vol.Coerce(int), vol.Range(min=1, max=50)
                ),
            }
        )

        return self.async_show_form(step_id="init", data_schema=data_schema)
