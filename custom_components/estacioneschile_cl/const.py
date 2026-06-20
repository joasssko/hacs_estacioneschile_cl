"""Constants for the Estaciones y Servicios Chile integration."""
import logging

LOGGER = logging.getLogger(__package__)

DOMAIN = "estacioneschile_cl"
PLATFORMS = ["sensor"]

# Configuration keys
CONF_TANK_CAPACITY = "tank_capacity"
CONF_PREFERRED_FUEL = "preferred_fuel"
CONF_STATION_COUNT = "station_count"

# Defaults
DEFAULT_TANK_CAPACITY = 50.0
DEFAULT_PREFERRED_FUEL = "Ninguno"
DEFAULT_STATION_COUNT = 10

# Fuel types mapping
FUEL_TYPES = {
    "Ninguno": "Ninguno",
    "93": "Gasolina 93",
    "95": "Gasolina 95",
    "97": "Gasolina 97",
    "Diesel": "Diesel",
    "Kerosene": "Kerosene",
    "GLP": "GLP",
    "GNC": "GNC",
    "Bluemax": "Bluemax",
}

# Mapping of fuel product codes from API response
PRODUCT_CODES = {
    "1": "93",
    "2": "97",
    "3": "Diesel",
    "4": "Kerosene",
    "5": "GNC",
    "6": "GLP",
    "7": "95",
    "20": "Bluemax",
}

# Services dictionary mapping from dictionary.txt
SERVICES_COPEC = {
    "1": "Pronto",
    "4": "Cajero Automático",
    "5": "Baño",
    "6": "Lavamax",
    "7": "Autoservicio",
    "8": "Voltex",
    "9": "Cupón Electrónico",
    "10": "TCT",
    "12": "Taxiamigo",
    "13": "Mobil",
    "15": "Asistida",
    "16": "TAE",
    "17": "Renova",
    "19": "Lavado Autoservicio",
    "20": "Lavado Automático",
    "21": "GeoGas",
    "24": "Mixta Autoservicio",
    "25": "TCT Premium",
    "29": "Bluemax Surtidor",
    "31": "Bluemax Bidón",
    "38": "LUB",
    "39": "Ciclista",
    "42": "App Copec",
    "57": "Retiro Tarjeta TaxiAmigo",
    "66": "Pronto Express",
    "77": "App Copec Empresa",
    "79": "Grabado de Patente",
    "86": "Promo Back to School",
    "76": "Lavado mascotas",
}

SERVICES_OTHER = {
    "1": "Lavado Manual",
    "2": "Lavado Automático",
    "3": "Lubricantes",
    "4": "Tienda Mayor",
    "5": "GNC",
    "6": "GLP",
    "7": "Cajero Automático",
    "8": "Nave de Lubricación",
    "9": "Farmacia",
    "10": "Tarjeta de Crédito",
    "11": "Cargador Electrico",
    "12": "Tienda Menor",
    "13": "Full Autoservicio",
    "14": "Mixta Autoservicio",
    "15": "Stripcenter",
    "76": "Lavado mascotas",
}
