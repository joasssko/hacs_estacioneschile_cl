"""Config flow for Estaciones y Servicios Chile integration."""
from __future__ import annotations

import asyncio
from typing import Any

from aiohttp import ClientError
import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

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
    FUEL_TYPES,
    KNOWN_COMPANIES,
    LOGGER,
)
from .coordinator import companies_in


async def _async_fetch_companies(hass: HomeAssistant) -> list[str]:
    """Read the company names from the API, falling back to a known list."""
    try:
        async with asyncio.timeout(20):
            response = await async_get_clientsession(hass).get(API_URL)
            raw = await response.json(content_type=None)
        companies = companies_in(raw) if isinstance(raw, list) else []
    except (ClientError, TimeoutError, ValueError) as err:
        LOGGER.debug("Could not read companies from the API: %s", err)
        companies = []
    return companies or list(KNOWN_COMPANIES)


def _build_schema(
    tank_capacity: float,
    preferred_fuel: str,
    station_count: int,
    consumption: float,
    companies: list[str],
    company_options: list[str],
) -> vol.Schema:
    """Return the form schema with the given defaults."""
    # Keep already-selected companies selectable even if the API no longer lists them
    options = sorted({*company_options, *companies}, key=str.casefold)
    return vol.Schema(
        {
            vol.Required(CONF_TANK_CAPACITY, default=float(tank_capacity)): vol.All(
                vol.Coerce(float), vol.Range(min=1, max=1000)
            ),
            vol.Required(CONF_PREFERRED_FUEL, default=preferred_fuel): vol.In(list(FUEL_TYPES)),
            vol.Required(CONF_CONSUMPTION, default=float(consumption)): NumberSelector(
                NumberSelectorConfig(
                    min=1, max=60, step=0.1, mode=NumberSelectorMode.BOX, unit_of_measurement="km/l"
                )
            ),
            vol.Optional(CONF_COMPANIES, default=list(companies)): SelectSelector(
                SelectSelectorConfig(
                    options=options,
                    multiple=True,
                    custom_value=True,
                    mode=SelectSelectorMode.DROPDOWN,
                )
            ),
            vol.Required(CONF_STATION_COUNT, default=int(station_count)): vol.All(
                vol.Coerce(int), vol.Range(min=1, max=50)
            ),
        }
    )


class EstacionesChileConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Estaciones y Servicios Chile."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial step."""
        # Only one instance: the sensor is always centred on the home zone
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(title="Estaciones Chile", data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=_build_schema(
                DEFAULT_TANK_CAPACITY,
                DEFAULT_PREFERRED_FUEL,
                DEFAULT_STATION_COUNT,
                DEFAULT_CONSUMPTION,
                [],
                await _async_fetch_companies(self.hass),
            ),
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Create the options flow."""
        return EstacionesChileOptionsFlowHandler()


class EstacionesChileOptionsFlowHandler(OptionsFlow):
    """Handle options flow for Estaciones y Servicios Chile.

    Since Home Assistant 2024.11 ``self.config_entry`` is provided automatically;
    assigning it manually is deprecated and fails on recent versions.
    """

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(data=user_input)

        entry = self.config_entry

        def current(key: str, default: Any) -> Any:
            return entry.options.get(key, entry.data.get(key, default))

        coordinator = getattr(entry, "runtime_data", None)
        company_options = getattr(coordinator, "companies", None) or await _async_fetch_companies(
            self.hass
        )

        return self.async_show_form(
            step_id="init",
            data_schema=_build_schema(
                current(CONF_TANK_CAPACITY, DEFAULT_TANK_CAPACITY),
                current(CONF_PREFERRED_FUEL, DEFAULT_PREFERRED_FUEL),
                current(CONF_STATION_COUNT, DEFAULT_STATION_COUNT),
                current(CONF_CONSUMPTION, DEFAULT_CONSUMPTION),
                current(CONF_COMPANIES, []),
                company_options,
            ),
        )
