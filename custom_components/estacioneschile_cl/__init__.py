"""The Estaciones y Servicios Chile integration."""
from __future__ import annotations

from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import CARD_FILENAME, CARD_URL_BASE, DOMAIN, PLATFORMS, VERSION
from .coordinator import EstacionesChileConfigEntry, EstacionesChileCoordinator

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the Lovelace card once per Home Assistant run.

    Doing this here (and not in async_setup_entry) avoids registering the same
    HTTP route twice when the entry is reloaded, which aiohttp rejects.
    """
    www_path = Path(__file__).parent / "www"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL_BASE, str(www_path), True)]
    )
    # Load the card automatically in every dashboard: no manual resource needed.
    # The version query string busts the browser cache after each update.
    add_extra_js_url(hass, f"{CARD_URL_BASE}/{CARD_FILENAME}?v={VERSION}")
    return True


async def async_setup_entry(hass: HomeAssistant, entry: EstacionesChileConfigEntry) -> bool:
    """Set up Estaciones y Servicios Chile from a config entry."""
    coordinator = EstacionesChileCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Reload when the options change
    entry.async_on_unload(entry.add_update_listener(update_listener))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: EstacionesChileConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def update_listener(hass: HomeAssistant, entry: EstacionesChileConfigEntry) -> None:
    """Reload integration when options are updated."""
    await hass.config_entries.async_reload(entry.entry_id)
