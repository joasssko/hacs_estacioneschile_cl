"""The Estaciones y Servicios Chile integration."""
from __future__ import annotations

from datetime import timedelta
import async_timeout

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN, LOGGER, PLATFORMS

API_URL = "https://integracion.copec.cl/stations?codEs=-1&company=-1&region=-1&comuna=-1"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Estaciones y Servicios Chile from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    # Register static path for custom card
    # Serves the www/ folder of the custom component at /estacioneschile_cl_local/
    # This exposes the Lovelace card: /estacioneschile_cl_local/estacioneschile-card.js
    www_path = hass.config.path("custom_components/estacioneschile_cl/www")
    hass.http.register_static_path(
        "/estacioneschile_cl_local",
        www_path,
        cache_headers=False,
    )

    session = async_get_clientsession(hass)

    async def async_update_data():
        """Fetch data from the Copec API."""
        try:
            async with async_timeout.timeout(30):
                response = await session.get(API_URL)
                if response.status != 200:
                    raise UpdateFailed(
                        f"Error fetching data from Copec API: HTTP status {response.status}"
                    )
                return await response.json()
        except Exception as err:
            raise UpdateFailed(f"Error communicating with Copec API: {err}") from err

    coordinator = DataUpdateCoordinator(
        hass,
        LOGGER,
        name=DOMAIN,
        update_method=async_update_data,
        update_interval=timedelta(minutes=30),  # Update every 30 minutes
    )

    # Trigger first refresh
    await coordinator.async_config_entry_first_refresh()

    hass.data[DOMAIN][entry.entry_id] = coordinator

    # Set up sensor platform
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Listen for configuration or option changes and trigger reload
    entry.async_on_unload(entry.add_update_listener(update_listener))

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok


async def update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload integration when options are updated."""
    await hass.config_entries.async_reload(entry.entry_id)
