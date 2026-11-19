/**
 * Custom Lovelace Card: Estaciones de Combustible Chile
 * Muestra las estaciones más cercanas en un mapa Leaflet y una lista dinámica.
 *
 * Compatible con los paneles actuales de Home Assistant (vista "Secciones",
 * modo oscuro del tema, tamaño dinámico de la tarjeta).
 */

const CARD_VERSION = '1.3.0';
const LEAFLET_VERSION = '1.9.4';
const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const DEFAULT_CENTER = [-33.4489, -70.6693]; // Santiago
const DEFAULT_CONSUMPTION = 14; // km/l
const FUELS = ['93', '95', '97', 'Diesel', 'Kerosene', 'GLP', 'GNC', 'Bluemax'];

// Mismas teselas que usa el mapa nativo de Home Assistant (CARTO), con variante clara y oscura.
const TILE_LAYERS = {
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' +
  ' &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatClp = (value) => `$${Number(value).toLocaleString('es-CL')}`;

/**
 * Carga Leaflet una sola vez para todas las tarjetas de la página.
 * El frontend de Home Assistant no expone su propia copia de Leaflet (window.L),
 * así que la tarjeta trae la suya, fijada a una versión concreta.
 */
function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (window.__estacionesChileLeaflet) return window.__estacionesChileLeaflet;

  window.__estacionesChileLeaflet = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      window.__estacionesChileLeaflet = null;
      script.remove();
      reject(new Error('No se pudo cargar Leaflet'));
    };
    document.head.appendChild(script);
  });
  return window.__estacionesChileLeaflet;
}

class EstacionesChileCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.activeFuel = null;
    this.expandedStationId = null;
    this.stations = [];
    this.home = DEFAULT_CENTER;
    this.map = null;
    this.tileLayer = null;
    this.markerLayer = null;
    this.stationMarkers = new Map();
    this._lastStateObj = null;
    this._lastStationIds = '';
    this._darkMode = null;
    this._needsFit = true;
    this._resizeObserver = null;
    this._skeletonReady = false;
  }

  // ---------------------------------------------------------------------------
  // API de tarjetas de Lovelace
  // ---------------------------------------------------------------------------

  static getStubConfig(hass) {
    const entity = Object.keys(hass?.states || {}).find(
      (id) => id.startsWith('sensor.') && Array.isArray(hass.states[id].attributes?.stations)
    );
    return { entity: entity || 'sensor.estaciones_chile_mas_cercanas' };
  }

  // Editor visual (Home Assistant 2024.11+): HA dibuja el formulario a partir de este esquema.
  static getConfigForm() {
    return {
      schema: [
        {
          name: 'entity',
          required: true,
          selector: { entity: { filter: { integration: 'estacioneschile_cl', domain: 'sensor' } } },
        },
        { name: 'title', selector: { text: {} } },
        {
          type: 'grid',
          name: '',
          schema: [
            {
              name: 'default_fuel',
              selector: {
                select: {
                  mode: 'dropdown',
                  options: [{ value: '', label: 'Según la integración' }].concat(
                    FUELS.map((f) => ({ value: f, label: f }))
                  ),
                },
              },
            },
            {
              name: 'theme_mode',
              selector: {
                select: {
                  mode: 'dropdown',
                  options: [
                    { value: 'auto', label: 'Automático (tema de HA)' },
                    { value: 'light', label: 'Claro' },
                    { value: 'dark', label: 'Oscuro' },
                  ],
                },
              },
            },
          ],
        },
        {
          name: 'map_height',
          selector: { number: { min: 120, max: 600, step: 10, mode: 'slider', unit_of_measurement: 'px' } },
        },
        { name: 'show_all', selector: { boolean: {} } },
      ],
      computeLabel: (schema) =>
        ({
          entity: 'Sensor de estaciones',
          title: 'Título',
          default_fuel: 'Combustible inicial',
          theme_mode: 'Estilo del mapa',
          map_height: 'Alto del mapa',
          show_all: 'Mostrar todas las compañías al abrir',
        })[schema.name],
      computeHelper: (schema) =>
        ({
          entity: 'Usa el sensor "Más cercanas" de la integración (el que tiene la lista de estaciones).',
          show_all: 'Solo aplica si elegiste compañías preferidas en la integración.',
        })[schema.name],
    };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error('Por favor especifica la entidad (entity) del sensor en la configuración.');
    }
    this.config = {
      title: 'Estaciones de Combustible',
      map_height: 220,
      theme_mode: 'auto', // auto | light | dark
      ...config,
    };
    this._lastStateObj = null;
    this._skeletonReady = false;
    this._errorMsg = null;
    this._darkMode = null;
    this.activeFuel = null; // se recalcula con la nueva configuración
    this._showAll = Boolean(this.config.show_all);
    if (this._hass) this.hass = this._hass;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.config) return;

    const stateObj = hass.states[this.config.entity];
    if (!stateObj) {
      this.renderError(`Entidad no encontrada: ${escapeHtml(this.config.entity)}`);
      this._lastStateObj = null;
      return;
    }

    if (!Array.isArray(stateObj.attributes?.stations)) {
      this.renderError(
        `La entidad ${escapeHtml(this.config.entity)} no tiene la lista de estaciones. ` +
          'Elige el sensor "Más cercanas" de la integración.'
      );
      this._lastStateObj = null;
      return;
    }

    this.initSkeleton();

    const darkMode = this.resolveDarkMode(hass);
    if (darkMode !== this._darkMode) {
      this._darkMode = darkMode;
      this.applyTileLayer();
    }

    // Home Assistant llama a este setter con cada cambio de cualquier entidad.
    // Solo se vuelve a dibujar cuando cambia el sensor de esta tarjeta.
    if (stateObj === this._lastStateObj) return;
    this._lastStateObj = stateObj;

    const attrs = stateObj.attributes;
    this.preferredStations = attrs.stations;
    // all_stations solo existe si el usuario eligió compañías preferidas en la integración
    this.allStations = Array.isArray(attrs.all_stations) ? attrs.all_stations : null;
    this.companies = Array.isArray(attrs.companies) ? attrs.companies : [];
    this.consumption = Number(attrs.consumption) || DEFAULT_CONSUMPTION;
    this.tankCapacity = Number(attrs.tank_capacity) || 50;
    this.prefFuel = attrs.preferred_fuel || '95';
    const lat = Number(attrs.home_latitude);
    const lon = Number(attrs.home_longitude);
    this.home = Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? [lat, lon] : DEFAULT_CENTER;

    if (!this.activeFuel) {
      this.activeFuel = FUELS.includes(this.config.default_fuel)
        ? this.config.default_fuel
        : this.prefFuel === 'Ninguno'
          ? '95'
          : this.prefFuel;
    }
    this.selectStations();

    // Solo se reencuadra el mapa si cambiaron las estaciones (no en cada actualización de precios),
    // para no perder el zoom que haya hecho el usuario.
    if (this.stationsChanged()) this._needsFit = true;

    this.ensureMap();
    this.updateTabs();
    this.updateList();
    this.updateMarkers();
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    const mapRows = Math.ceil((Number(this.config?.map_height) || 220) / 50);
    return 2 + mapRows + Math.min(this.stations.length, 5);
  }

  // Tamaño en la vista "Secciones" (Home Assistant 2024.8+).
  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: 'auto' };
  }

  connectedCallback() {
    if (this.map) {
      // Al volver a mostrar el panel el contenedor puede haber cambiado de tamaño.
      requestAnimationFrame(() => this.map && this.map.invalidateSize());
    }
    this.observeResize();
  }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

  resolveDarkMode(hass) {
    const mode = this.config.theme_mode;
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return Boolean(hass.themes && hass.themes.darkMode);
  }

  stationsChanged() {
    const ids = this.stations.map((s) => String(s.id)).join('|');
    const changed = ids !== this._lastStationIds;
    this._lastStationIds = ids;
    return changed;
  }

  /** Elige la lista visible (preferidas o todas) y recalcula lo que depende del combustible. */
  selectStations() {
    this.stations = this._showAll && this.allStations ? this.allStations : this.preferredStations || [];
    this.refreshFuel();
  }

  refreshFuel() {
    this.cheapestStationId = this.findCheapestStationId(this.activeFuel);
    this.savings = this.computeSavings(this.activeFuel);
  }

  /**
   * Ahorro neto de llenar el estanque en cada estación en vez de en la más cercana que vende
   * el combustible. Ir más lejos cuesta el viaje extra de ida y vuelta (distancia en línea recta)
   * según el consumo del vehículo. Misma fórmula que el sensor "Mayor ahorro".
   */
  computeSavings(fuel) {
    const result = new Map();
    const selling = this.stations.filter((s) => s.prices && s.prices[fuel] !== undefined);
    if (!selling.length) return result;
    const ref = selling.reduce((a, b) => (b.distance < a.distance ? b : a));
    const refPrice = ref.prices[fuel];
    for (const s of selling) {
      const price = s.prices[fuel];
      const extraKm = 2 * Math.max(0, s.distance - ref.distance);
      const travelCost = (extraKm / this.consumption) * price;
      result.set(String(s.id), {
        value: Math.round((refPrice - price) * this.tankCapacity - travelCost),
        isReference: s === ref,
        extraKm: Math.round(extraKm * 10) / 10,
        travelCost: Math.round(travelCost),
      });
    }
    return result;
  }

  savingHtml(id, short) {
    const saving = this.savings && this.savings.get(String(id));
    if (!saving) return '';
    if (saving.isReference) return '<span class="saving ref">Referencia (la más cercana)</span>';
    if (saving.value > 0) return `<span class="saving pos">Ahorras ${formatClp(saving.value)}</span>`;
    if (saving.value < 0) {
      return `<span class="saving neg">${short ? '' : 'No conviene: '}cuesta ${formatClp(-saving.value)} más</span>`;
    }
    return '<span class="saving ref">Mismo costo</span>';
  }

  findCheapestStationId(fuel) {
    let cheapestId = null;
    let minPrice = Infinity;
    for (const s of this.stations) {
      const price = s.prices ? s.prices[fuel] : undefined;
      if (price !== undefined && price !== null && price < minPrice) {
        minPrice = price;
        cheapestId = s.id;
      }
    }
    return cheapestId;
  }

  renderError(msg) {
    if (this._errorMsg === msg) return; // evita redibujar el mismo error en cada actualización
    this._errorMsg = msg;
    this._skeletonReady = false;
    this.destroyMap();
    this.shadowRoot.innerHTML = `
      <ha-card style="padding: 16px;">
        <ha-alert alert-type="error" title="Estaciones Chile">${msg}</ha-alert>
      </ha-card>
    `;
  }

  // ---------------------------------------------------------------------------
  // Estructura
  // ---------------------------------------------------------------------------

  initSkeleton() {
    if (this._skeletonReady) return;
    this._errorMsg = null;
    this.destroyMap();
    this._lastStationIds = '';
    this._needsFit = true;

    const mapHeight = Number(this.config.map_height) || 220;

    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="${LEAFLET_CSS}">
      <style>
        ha-card {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          overflow: hidden;
        }
        .card-header { display: flex; flex-direction: column; gap: 12px; }
        .header-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 18px;
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .header-title ha-icon { color: var(--primary-color); --mdc-icon-size: 24px; }

        .fuel-tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; }
        .fuel-tab {
          padding: 6px 14px;
          background: var(--secondary-background-color);
          border: 1px solid var(--divider-color);
          border-radius: 16px;
          font: inherit;
          font-size: 12px;
          font-weight: 500;
          color: var(--secondary-text-color);
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.2s, color 0.2s;
        }
        .fuel-tab:hover { color: var(--primary-text-color); }
        .fuel-tab.active {
          background: var(--primary-color);
          border-color: transparent;
          color: var(--text-primary-color, #fff);
        }

        .map-container {
          width: 100%;
          height: ${mapHeight}px;
          border-radius: 10px;
          overflow: hidden;
          position: relative;
          border: 1px solid var(--divider-color);
          isolation: isolate; /* las capas de Leaflet no tapan los diálogos de HA */
        }
        #map { width: 100%; height: 100%; background: var(--secondary-background-color); }
        .map-message {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 16px;
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        .leaflet-container { font-family: inherit; }
        .leaflet-popup-content-wrapper, .leaflet-popup-tip {
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
        }
        .leaflet-container a.leaflet-popup-close-button { color: var(--secondary-text-color); }
        .dark .leaflet-control-attribution { background: rgba(0, 0, 0, 0.5); color: #bbb; }
        .dark .leaflet-control-attribution a { color: #ddd; }
        .dark .leaflet-bar a { background: #2b2b2b; color: #eee; border-color: #444; }

        .marker-icon { background: none !important; border: none !important; }
        .marker-dot {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: 50%;
          border: 3px solid #fff;
          box-shadow: 0 0 8px rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 9px;
          font-weight: bold;
        }
        .popup { font-size: 11px; line-height: 1.4; }
        .popup b { font-size: 12px; }

        .stations-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 320px;
          overflow-y: auto;
          padding-right: 2px;
          scrollbar-width: thin;
        }
        .station-row {
          background: var(--secondary-background-color);
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          cursor: pointer;
          transition: border-color 0.2s;
        }
        .station-row.expanded { border-color: var(--primary-color); }
        .station-row.cheapest { border-left: 4px solid var(--success-color, #4caf50); }
        .station-main { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .station-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
        .brand-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 14px;
          color: #fff;
          flex-shrink: 0;
        }
        .brand-copec { background: linear-gradient(135deg, #e52d27 0%, #b31010 100%); }
        .brand-other { background: linear-gradient(135deg, #7474bf 0%, #348ac7 100%); }
        .station-info { display: flex; flex-direction: column; min-width: 0; }
        .station-address {
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .station-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--secondary-text-color);
          margin-top: 2px;
        }
        .company { font-weight: 600; color: var(--primary-color); }
        .station-right { display: flex; align-items: flex-end; gap: 8px; }
        .price-badge { display: flex; flex-direction: column; align-items: flex-end; }
        .price-label { font-size: 9px; text-transform: uppercase; color: var(--secondary-text-color); }
        .price-value { font-size: 14px; font-weight: bold; color: var(--primary-text-color); }
        .station-row.cheapest .price-value { color: var(--success-color, #4caf50); }
        .full-tank-badge {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          border: 1px solid var(--primary-color);
          padding: 3px 8px;
          border-radius: 8px;
          min-width: 75px;
        }
        .full-tank-label { font-size: 8px; text-transform: uppercase; color: var(--primary-color); font-weight: 600; }
        .full-tank-val { font-size: 12px; font-weight: bold; color: var(--primary-color); }

        .station-details {
          margin-top: 10px;
          border-top: 1px solid var(--divider-color);
          padding-top: 10px;
          display: none;
          flex-direction: column;
          gap: 10px;
          cursor: default;
        }
        .station-row.expanded .station-details { display: flex; }
        .prices-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(75px, 1fr)); gap: 6px; }
        .price-item {
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          padding: 4px 6px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .price-item.active-fuel-price { border-color: var(--primary-color); }
        .price-item-label { font-size: 9px; color: var(--secondary-text-color); }
        .price-item-val { font-size: 11px; font-weight: bold; color: var(--primary-text-color); }
        .section-subtitle {
          font-size: 10px;
          text-transform: uppercase;
          color: var(--secondary-text-color);
          font-weight: bold;
        }
        .amenities-section { display: flex; flex-direction: column; gap: 4px; }
        .services-list { display: flex; flex-wrap: wrap; gap: 4px; }
        .service-tag {
          border: 1px solid var(--divider-color);
          color: var(--primary-text-color);
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 10px;
        }
        .row-actions { display: flex; justify-content: flex-end; }
        .row-actions a { font-size: 11px; color: var(--primary-color); text-decoration: none; }
        .view-toggle { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .view-toggle:empty { display: none; }
        .view-label { font-size: 12px; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .view-btn {
          flex-shrink: 0;
          font: inherit;
          font-size: 12px;
          font-weight: 500;
          padding: 4px 12px;
          border-radius: 14px;
          border: 1px solid var(--primary-color);
          background: transparent;
          color: var(--primary-color);
          cursor: pointer;
        }
        .view-btn[aria-pressed='true'] { background: var(--primary-color); color: var(--text-primary-color, #fff); }
        .saving { font-size: 11px; font-weight: 600; margin-top: 3px; }
        .saving.pos { color: var(--success-color, #4caf50); }
        .saving.neg { color: var(--error-color, #db4437); }
        .saving.ref { color: var(--secondary-text-color); font-weight: 500; }
        .saving-detail { font-size: 11px; color: var(--secondary-text-color); line-height: 1.5; }
        .empty { text-align: center; color: var(--secondary-text-color); font-size: 12px; padding: 20px; }
      </style>
      <ha-card>
        <div class="card-header">
          <div class="header-title">
            <ha-icon icon="mdi:gas-station"></ha-icon>
            <span>${escapeHtml(this.config.title)}</span>
          </div>
          <div class="fuel-tabs" id="fuel-tabs" role="tablist"></div>
          <div class="view-toggle" id="view-toggle"></div>
        </div>
        <div class="map-container" id="map-container">
          <div id="map"></div>
        </div>
        <div class="stations-list" id="stations-list"></div>
      </ha-card>
    `;

    // Un solo listener por contenedor (delegación) en vez de uno por elemento en cada render.
    this.shadowRoot.getElementById('fuel-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.fuel-tab');
      if (!tab) return;
      this.activeFuel = tab.dataset.fuel;
      this.refreshFuel();
      this.updateTabs();
      this.updateList();
      this.updateMarkers();
    });

    this.shadowRoot.getElementById('view-toggle').addEventListener('click', (e) => {
      if (!e.target.closest('button')) return;
      this._showAll = !this._showAll;
      this.expandedStationId = null;
      this.selectStations();
      if (this.stationsChanged()) this._needsFit = true;
      this.updateTabs();
      this.updateList();
      this.updateMarkers();
    });

    this.shadowRoot.getElementById('stations-list').addEventListener('click', (e) => {
      if (e.target.closest('.station-details')) return;
      const row = e.target.closest('.station-row');
      if (!row) return;
      const id = row.dataset.id;
      this.expandedStationId = this.expandedStationId === id ? null : id;
      this.updateList();
      this.focusStation(id);
    });

    this._skeletonReady = true;
    this.observeResize();
  }

  observeResize() {
    if (this._resizeObserver || !window.ResizeObserver) return;
    const container = this.shadowRoot.getElementById('map-container');
    if (!container) return;
    this._resizeObserver = new ResizeObserver(() => {
      if (!this.map) return;
      this.map.invalidateSize();
      this.fitToMarkers();
    });
    this._resizeObserver.observe(container);
  }

  // ---------------------------------------------------------------------------
  // Mapa
  // ---------------------------------------------------------------------------

  ensureMap() {
    if (this.map || this._mapLoading) return;
    this._mapLoading = true;

    loadLeaflet()
      .then((L) => {
        this._mapLoading = false;
        const mapEl = this.shadowRoot.getElementById('map');
        if (!mapEl || this.map) return;

        this.map = L.map(mapEl, {
          center: this.home,
          zoom: 13,
          // Evita que la rueda del mouse haga zoom mientras se desplaza el panel.
          scrollWheelZoom: false,
        });
        this.markerLayer = L.featureGroup().addTo(this.map);
        this.applyTileLayer();
        this._needsFit = true;
        this.updateMarkers();
        requestAnimationFrame(() => this.map && this.map.invalidateSize());
      })
      .catch((err) => {
        this._mapLoading = false;
        console.error('[estacioneschile-card]', err);
        const container = this.shadowRoot.getElementById('map-container');
        if (container) {
          container.innerHTML =
            '<div class="map-message">No se pudo cargar el mapa. Revisa la conexión a internet de este navegador.</div>';
        }
      });
  }

  applyTileLayer() {
    if (!this.map || !window.L) return;
    if (this.tileLayer) this.map.removeLayer(this.tileLayer);
    const dark = Boolean(this._darkMode);
    this.tileLayer = window.L.tileLayer(dark ? TILE_LAYERS.dark : TILE_LAYERS.light, {
      attribution: TILE_ATTRIBUTION,
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(this.map);
    const container = this.shadowRoot.getElementById('map-container');
    if (container) container.classList.toggle('dark', dark);
  }

  destroyMap() {
    if (this.map) this.map.remove();
    this.map = null;
    this.tileLayer = null;
    this.markerLayer = null;
    this.stationMarkers.clear();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  makeIcon(color, label, size) {
    return window.L.divIcon({
      className: 'marker-icon',
      html: `<div class="marker-dot" style="background-color:${color}">${label}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
  }

  updateMarkers() {
    if (!this.map || !this.markerLayer || !window.L) return;

    this.markerLayer.clearLayers();
    this.stationMarkers.clear();

    const homeMarker = window.L.marker(this.home, {
      icon: this.makeIcon('#03a9f4', '', 20),
      title: 'Casa',
      zIndexOffset: 1000,
    }).bindPopup('<div class="popup"><b>Tu ubicación (Casa)</b></div>');
    this.markerLayer.addLayer(homeMarker);

    this.stations.forEach((station, index) => {
      const lat = Number(station.latitude);
      const lon = Number(station.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      const isCheapest = this.cheapestStationId === station.id;
      const price = station.prices ? station.prices[this.activeFuel] : undefined;
      const priceText = price ? `${formatClp(price)}/L` : 'N/A';

      const marker = window.L.marker([lat, lon], {
        icon: this.makeIcon(isCheapest ? '#4caf50' : '#ff9800', index + 1, 24),
        title: `${station.company || ''} ${station.address || ''}`.trim(),
        zIndexOffset: isCheapest ? 500 : 0,
      }).bindPopup(`
        <div class="popup">
          <b>#${index + 1} ${escapeHtml(station.company)}</b><br>
          ${escapeHtml(station.address)}<br>
          ${escapeHtml(this.activeFuel)}: <b>${priceText}</b> · ${escapeHtml(station.distance)} km
          <br>${this.savingHtml(station.id, true)}
        </div>
      `);

      this.markerLayer.addLayer(marker);
      this.stationMarkers.set(String(station.id), marker);
    });

    this.fitToMarkers();
  }

  fitToMarkers() {
    if (!this._needsFit || !this.map || !this.markerLayer) return;
    // Si la tarjeta aún no es visible (pestaña oculta, editor), el mapa mide 0 px y el encuadre
    // saldría mal: se deja pendiente hasta que el ResizeObserver detecte el tamaño real.
    const size = this.map.getSize();
    if (!size.x || !size.y) return;
    this._needsFit = false;
    const bounds = this.markerLayer.getBounds();
    if (bounds.isValid() && this.stationMarkers.size > 0) {
      this.map.fitBounds(bounds.pad(0.1), { maxZoom: 15 });
    } else {
      this.map.setView(this.home, 13);
    }
  }

  focusStation(id) {
    const station = this.stations.find((s) => String(s.id) === String(id));
    const marker = this.stationMarkers.get(String(id));
    if (!this.map || !station || !marker) return;
    this.map.flyTo([Number(station.latitude), Number(station.longitude)], 15, { duration: 0.5 });
    marker.openPopup();
  }

  // ---------------------------------------------------------------------------
  // Pestañas y lista
  // ---------------------------------------------------------------------------

  updateTabs() {
    const tabsContainer = this.shadowRoot.getElementById('fuel-tabs');
    if (!tabsContainer) return;
    tabsContainer.innerHTML = FUELS.map(
      (fuel) => `
        <button type="button" role="tab" class="fuel-tab ${this.activeFuel === fuel ? 'active' : ''}"
          aria-selected="${this.activeFuel === fuel}" data-fuel="${fuel}">${fuel}</button>
      `
    ).join('');

    const toggle = this.shadowRoot.getElementById('view-toggle');
    if (!toggle) return;
    if (!this.allStations) {
      toggle.innerHTML = '';
      return;
    }
    const names = this.companies.map(escapeHtml).join(', ');
    toggle.innerHTML = `
      <span class="view-label">${this._showAll ? 'Todas las compañías' : `Solo: ${names}`}</span>
      <button type="button" class="view-btn" aria-pressed="${this._showAll}">
        ${this._showAll ? 'Ver solo preferidas' : 'Ver todas'}
      </button>
    `;
  }

  savingDetailHtml(id) {
    const saving = this.savings && this.savings.get(String(id));
    if (!saving || saving.isReference) return '';
    return `
      <div class="amenities-section">
        <span class="section-subtitle">Ahorro vs. la más cercana (${escapeHtml(this.activeFuel)})</span>
        <span class="saving-detail">
          ${this.savingHtml(id, false)} · llenando ${escapeHtml(this.tankCapacity)} L, descontando
          ${escapeHtml(saving.extraKm)} km extra de ida y vuelta (${formatClp(saving.travelCost)} a
          ${escapeHtml(this.consumption)} km/l)
        </span>
      </div>
    `;
  }

  updateList() {
    const listContainer = this.shadowRoot.getElementById('stations-list');
    if (!listContainer) return;

    if (!this.stations.length) {
      listContainer.innerHTML = '<div class="empty">No se encontraron estaciones cercanas.</div>';
      return;
    }

    listContainer.innerHTML = this.stations
      .map((station, index) => {
        const company = String(station.company || '');
        const isCopec = company.toUpperCase().includes('COPEC');
        const prices = station.prices || {};
        const services = Array.isArray(station.services) ? station.services : [];
        const price = prices[this.activeFuel];
        const id = String(station.id);
        const isExpanded = this.expandedStationId === id;
        const isCheapest = this.cheapestStationId === station.id;

        let fullTankHtml = '';
        if (price && this.tankCapacity) {
          fullTankHtml = `
            <div class="full-tank-badge">
              <span class="full-tank-label">Llenar (${escapeHtml(this.tankCapacity)}L)</span>
              <span class="full-tank-val">${formatClp(Math.round(price * this.tankCapacity))}</span>
            </div>
          `;
        }

        const pricesGridHtml = Object.entries(prices)
          .map(
            ([fuelType, val]) => `
              <div class="price-item ${this.activeFuel === fuelType ? 'active-fuel-price' : ''}">
                <span class="price-item-label">${escapeHtml(fuelType)}</span>
                <span class="price-item-val">${formatClp(val)}</span>
              </div>
            `
          )
          .join('');

        const servicesHtml = services.length
          ? services.map((ser) => `<span class="service-tag">${escapeHtml(ser)}</span>`).join('')
          : '<span class="section-subtitle">Sin información</span>';

        const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
          `${station.latitude},${station.longitude}`
        )}`;

        return `
          <div class="station-row ${isExpanded ? 'expanded' : ''} ${isCheapest ? 'cheapest' : ''}" data-id="${escapeHtml(id)}">
            <div class="station-main">
              <div class="station-left">
                <div class="brand-icon ${isCopec ? 'brand-copec' : 'brand-other'}">${index + 1}</div>
                <div class="station-info">
                  <span class="station-address">${escapeHtml(station.address)}</span>
                  <div class="station-meta">
                    <span class="company">${escapeHtml(company)}</span>
                    <span>•</span>
                    <span>${escapeHtml(station.comuna)}</span>
                    <span>•</span>
                    <span>${escapeHtml(station.distance)} km</span>
                  </div>
                  ${this.savingHtml(id, true)}
                </div>
              </div>
              <div class="station-right">
                <div class="price-badge">
                  <span class="price-label">${escapeHtml(this.activeFuel)} / L</span>
                  <span class="price-value">${price ? formatClp(price) : '--'}</span>
                </div>
                ${fullTankHtml}
              </div>
            </div>
            <div class="station-details">
              ${this.savingDetailHtml(id)}
              <div class="amenities-section">
                <span class="section-subtitle">Todos los combustibles</span>
                <div class="prices-grid">${pricesGridHtml}</div>
              </div>
              <div class="amenities-section">
                <span class="section-subtitle">Servicios</span>
                <div class="services-list">${servicesHtml}</div>
              </div>
              <div class="row-actions">
                <a href="${directionsUrl}" target="_blank" rel="noopener noreferrer">Cómo llegar ↗</a>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }
}

// La guarda evita el error "already defined" si el archivo se carga dos veces
// (por ejemplo, registrado automáticamente y también como recurso manual antiguo).
if (!customElements.get('estacioneschile-card')) {
  customElements.define('estacioneschile-card', EstacionesChileCard);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'estacioneschile-card',
    name: 'Estaciones de Combustible Chile',
    description: 'Muestra las estaciones chilenas más cercanas en un mapa y una lista con precios de combustibles.',
    preview: true,
    documentationURL: 'https://github.com/joasssko/hacs_estacioneschile_cl',
  });

  console.info(
    `%c ESTACIONESCHILE-CARD %c v${CARD_VERSION} `,
    'color:#fff;background:#e52d27;font-weight:bold',
    'color:#e52d27'
  );
}
