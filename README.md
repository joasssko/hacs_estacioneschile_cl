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
* 🏷️ **Compañías Preferidas**: Elige una o varias compañías (por ejemplo Copec y Shell) y solo esas se muestran en el mapa, los sensores y el cálculo de ahorro. En la tarjeta puedes cambiar a "Ver todas" cuando quieras.
* 🐷 **Cálculo de Ahorro**: Compara cada estación con la más cercana y te dice cuánto ahorras (o pierdes) yendo a cargar a otra, descontando el combustible que gastas en el viaje extra.
* 💡 **Búsqueda del Combustible Más Económico**: Detecta automáticamente cuál de las estaciones más cercanas ofrece el precio más barato para el tipo de combustible configurado.
* 🔧 **Configuración Dinámica (Options Flow)**: Puedes cambiar la capacidad de tu estanque, combustible seleccionado o número de estaciones en cualquier momento directamente desde la pantalla de integraciones de Home Assistant, sin necesidad de reiniciar la plataforma.

---

## Instalación y Configuración

**Requisitos**: Home Assistant 2025.2 o superior.

### 1. Instalar la Integración
**Con HACS (recomendado)**: en HACS abre el menú de tres puntos -> **Repositorios personalizados**, agrega `https://github.com/joasssko/hacs_estacioneschile_cl` con la categoría **Integración** y luego descarga **Estaciones de combustible y servicios en Chile**.

**Manual**: coloca el directorio `custom_components/estacioneschile_cl` dentro de la carpeta `config/custom_components/` de tu instancia de Home Assistant.

### 2. Reiniciar Home Assistant
Ve a **Ajustes** -> menú de tres puntos -> **Reiniciar Home Assistant** para que Home Assistant reconozca el nuevo componente.

### 3. Añadir la Integración
1. Ve a **Ajustes** -> **Dispositivos y Servicios** -> **Añadir Integración**.
2. Busca **Estaciones y servicios Chile**.
3. Sigue las instrucciones del formulario de configuración:
   * **Capacidad del estanque**: Capacidad en litros de tu vehículo (ej. `50.0`).
   * **Combustible preferido**: El combustible que usa tu vehículo (`93`, `95`, `97`, `Diesel`, `Kerosene`, `GLP`, `GNC`, `Bluemax` o `Ninguno`).
   * **Consumo promedio (km/l)**: Rendimiento de tu vehículo, usado para el cálculo de ahorro (por defecto `14`).
   * **Compañías preferidas**: Opcional. Si eliges alguna, solo esas compañías se usan en el mapa y los sensores. Vacío = todas. La lista se lee de la API; también puedes escribir el nombre.
   * **Número de estaciones a mostrar**: Cuántas estaciones cercanas deseas cargar en el sensor (por defecto `10`).

Todo esto se puede cambiar después en **Ajustes** -> **Dispositivos y Servicios** -> **Estaciones y servicios Chile** -> **Configurar**.

### Cómo se calcula el ahorro

La referencia es la estación más cercana a tu casa que vende el combustible. Para cada otra estación:

```
ahorro = (precio_referencia - precio_estación) × litros_del_estanque
         - (km_extra_ida_y_vuelta ÷ consumo_km_l) × precio_estación
```

Los km extra son `2 × (distancia_estación - distancia_referencia)`, en línea recta desde tu casa, así que la distancia real por calles suele ser algo mayor. Un valor negativo significa que no conviene ir.

---

## Entidades que crea la integración

Todas quedan agrupadas en el dispositivo **Estaciones Chile**.

| Entidad | Ejemplo de ID | Qué muestra |
| --- | --- | --- |
| Más cercanas | `sensor.estaciones_chile_mas_cercanas` | Precio de tu combustible preferido en la estación más cercana que lo vende (o la distancia, si no elegiste combustible). Sus atributos tienen la lista de estaciones que usa la tarjeta. |
| Más barato (uno por combustible) | `sensor.estaciones_chile_mas_barato_gasolina_95` | Precio más bajo de ese combustible entre las estaciones cercanas, con la estación, su dirección, el costo de llenar el estanque y su ubicación. Guarda historial, así que sirve para gráficos y automatizaciones. Los de 93, 95, 97 y Diesel vienen activados; Kerosene, GLP, GNC y Bluemax se pueden activar desde el dispositivo. |
| Mayor ahorro | `sensor.estaciones_chile_mayor_ahorro` | Cuánto ahorras (en CLP) llenando tu combustible preferido en la mejor estación cercana en vez de la más cercana. Sus atributos dicen qué estación es, la de referencia y sus precios. Vale 0 si la más cercana ya es la mejor. |
| Una por estación | `geo_location.copec_av_ejemplo_123` | Cada estación cercana como punto en el mapa, con su distancia como estado y los precios como atributos. Se crean y eliminan solas cuando cambian las estaciones cercanas. |

> Los ID exactos dependen del idioma de tu Home Assistant al instalar (en inglés, por ejemplo, `sensor.estaciones_chile_closest_stations`).

### Ejemplo de automatización

```yaml
alias: Aviso bencina 95 barata
triggers:
  - trigger: numeric_state
    entity_id: sensor.estaciones_chile_mas_barato_gasolina_95
    below: 1250
actions:
  - action: notify.notify
    data:
      message: >-
        La 95 está a ${{ states('sensor.estaciones_chile_mas_barato_gasolina_95') }}/L en
        {{ state_attr('sensor.estaciones_chile_mas_barato_gasolina_95', 'company') }}
        {{ state_attr('sensor.estaciones_chile_mas_barato_gasolina_95', 'address') }}
```

---

## Mapa nativo de Home Assistant

Si prefieres la tarjeta de mapa estándar (sin la tarjeta personalizada), usa las entidades de ubicación:

```yaml
type: map
geo_location_sources:
  - estacioneschile_cl
```

También puedes agregar al mapa los sensores **Más barato**, que incluyen la ubicación de la estación ganadora.

---

## Tarjeta Personalizada Lovelace (Dashboard)

### 1. Recurso de Lovelace (automático)
Desde la versión 1.1.0 la integración registra la tarjeta automáticamente en todos los tableros: **no necesitas añadir ningún recurso**. Después de instalar o actualizar, recarga el navegador (o la app) para que se cargue la nueva versión.

> Si en una versión anterior agregaste a mano el recurso `/estacioneschile_cl_local/estacioneschile-card.js`, puedes eliminarlo en **Ajustes** -> **Paneles** -> menú de tres puntos -> **Recursos**. No causa errores si lo dejas, pero ya no es necesario.

### 2. Agregar la Tarjeta en tu Panel
Edita tu tablero, haz clic en **Añadir Tarjeta** y busca **Estaciones de Combustible Chile**. La tarjeta tiene **editor visual**: puedes elegir el sensor, el título, el combustible inicial, el estilo y el alto del mapa sin escribir YAML. Si prefieres YAML:

```yaml
type: custom:estacioneschile-card
entity: sensor.estaciones_chile_mas_cercanas
```

Opciones disponibles:

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `entity` | (obligatoria) | Sensor creado por la integración. |
| `title` | `Estaciones de Combustible` | Título de la tarjeta. |
| `map_height` | `220` | Alto del mapa en píxeles. |
| `default_fuel` | (el preferido de la integración) | Combustible seleccionado al abrir la tarjeta: `93`, `95`, `97`, `Diesel`, `Kerosene`, `GLP`, `GNC` o `Bluemax`. |
| `show_all` | `false` | Si elegiste compañías preferidas, abre la tarjeta mostrando todas las compañías. Siempre puedes alternar con el botón **Ver todas** / **Ver solo preferidas**. |
| `theme_mode` | `auto` | `auto` sigue el modo claro u oscuro de Home Assistant; también acepta `light` o `dark`. |

La tarjeta funciona en la vista **Secciones** (ocupa el ancho completo por defecto y se puede reducir hasta la mitad).

### Funciones de la Tarjeta
* 🗺️ **Mapa Interactivo**: Muestra un marcador azul en tu hogar y marcadores naranjas para las estaciones de servicio más cercanas. La estación con el precio más barato para el combustible seleccionado se destaca con un marcador **verde**.
* ⚡ **Selectores Dinámicos**: Permite alternar la visualización entre los tipos de combustible (`93`, `95`, `97`, etc.) directamente en la tarjeta, recalculando los costos de llenado en tiempo real.
* 🔍 **Enfoque de Mapa y Popups**: Al hacer clic en cualquier estación de la lista, el mapa se centrará en ella de forma suave y abrirá su información detallada.
* 🌙 **Mapa sin API key y con modo oscuro**: Desde Home Assistant 2026.10 el mapa carga las teselas a través de la integración nativa **Map tiles** (OpenStreetMap, cacheadas por tu Home Assistant), así que no aparece el aviso "API KEY REQUIRED". En versiones anteriores usa las teselas estándar de OpenStreetMap. Sigue el modo claro u oscuro de tu tema.
* 🧭 **Cómo llegar**: Cada estación expandida incluye un enlace para abrir la ruta en Google Maps.
* 📦 **Acordeón de Detalles**: Al presionar una estación, esta se expandirá para mostrar la grilla completa de precios para todos sus combustibles disponibles, junto a una lista de etiquetas visuales con las amenidades y servicios que ofrece.