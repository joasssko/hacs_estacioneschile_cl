# Estaciones y Servicios Chile (Home Assistant Integration)

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=for-the-badge)](https://github.com/hacs/integration)
![Home Assistant Version](https://img.shields.io/badge/Home%20Assistant-Core-blue?style=for-the-badge)
![Languages Supported](https://img.shields.io/badge/Language-ES%20%7C%20EN-orange?style=for-the-badge)

Esta integración permite monitorear y comparar los precios de los combustibles y servicios de las estaciones de servicio (COPEC y otras compañías como Shell, Aramco, etc.) en Chile, mostrando las estaciones más cercanas a tu hogar y calculando de forma inteligente el costo para llenar el estanque de tu vehículo.

Los datos se obtienen de forma dinámica y actualizada directamente de la API pública de Copec.

---

## Características Principales

* 📍 **Cálculo de Distancia Geodésica**: Utiliza las coordenadas de tu hogar configuradas en Home Assistant (leyendo `zone.home` y cayendo de forma automática en la configuración global de HA) para calcular la distancia en tiempo real a cada estación mediante la fórmula de Haversine.
* 🚗 **Filtro de Proximidad**: Ordena y muestra únicamente la cantidad seleccionada de estaciones más cercanas a tu ubicación (por defecto las 10 más cercanas).
* 💰 **Calculadora de Carga de Estanque**: Permite ingresar la capacidad de tu estanque en litros en la configuración, calculando el costo total para llenar el estanque con tu combustible de preferencia en cada gasolinera.
* 💡 **Búsqueda del Combustible Más Económico**: Detecta automáticamente cuál de las estaciones más cercanas ofrece el precio más barato para el tipo de combustible configurado.
* 🔧 **Configuración Dinámica (Options Flow)**: Puedes cambiar la capacidad de tu estanque, combustible seleccionado o número de estaciones en cualquier momento directamente desde la pantalla de integraciones de Home Assistant, sin necesidad de reiniciar la plataforma.

---

## Instalación y Configuración

### 1. Copiar los Archivos de la Integración
Coloca el directorio `custom_components/estacioneschile_cl` dentro de la carpeta `config/custom_components/` de tu instancia de Home Assistant.

### 2. Reiniciar Home Assistant
Ve a **Herramientas de Desarrollador** -> **Controles de YAML** y presiona **Reiniciar** para que Home Assistant reconozca el nuevo componente.

### 3. Añadir la Integración
1. Ve a **Ajustes** -> **Dispositivos y Servicios** -> **Añadir Integración**.
2. Busca **Estaciones y servicios Chile**.
3. Sigue las instrucciones del formulario de configuración:
   * **Capacidad del estanque**: Capacidad en litros de tu vehículo (ej. `50.0`).
   * **Combustible preferido**: El combustible que usa tu vehículo (`93`, `95`, `97`, `Diesel`, `Kerosene`, `GLP`, `GNC`, `Bluemax` o `Ninguno`).
   * **Número de estaciones a mostrar**: Cuántas estaciones cercanas deseas cargar en el sensor (por defecto `10`).

---

## Tarjeta Personalizada Lovelace (Dashboard)

### 1. Registrar el Recurso de Lovelace
Para poder utilizar la tarjeta personalizada, debes registrarla en los recursos de tu Dashboard:
1. Ve a **Ajustes** -> **Tableros** -> Haz clic en los tres puntos de la esquina superior derecha -> **Recursos**.
2. Presiona **Añadir Recurso**.
3. Configura los siguientes campos:
   * **URL**: `/estacioneschile_cl_local/estacioneschile-card.js`
   * **Tipo de recurso**: `Módulo de JavaScript`

### 2. Agregar la Tarjeta en tu Panel
Edita tu tablero, haz clic en **Añadir Tarjeta**, selecciona la opción **Manual** al final de la lista e introduce la siguiente configuración:

```yaml
type: custom:estacioneschile-card
entity: sensor.estacioneschile_closest_stations
```

### Funciones de la Tarjeta
* 🗺️ **Mapa Interactivo**: Muestra un marcador azul en tu hogar y marcadores naranjas para las estaciones de servicio más cercanas. La estación con el precio más barato para el combustible seleccionado se destaca con un marcador **verde**.
* ⚡ **Selectores Dinámicos**: Permite alternar la visualización entre los tipos de combustible (`93`, `95`, `97`, etc.) directamente en la tarjeta, recalculando los costos de llenado en tiempo real.
* 🔍 **Enfoque de Mapa y Popups**: Al hacer clic en cualquier estación de la lista, el mapa se centrará en ella de forma suave y abrirá su información detallada.
* 📦 **Acordeón de Detalles**: Al presionar una estación, esta se expandirá para mostrar la grilla completa de precios para todos sus combustibles disponibles, junto a una lista de etiquetas visuales con las amenidades y servicios que ofrece.