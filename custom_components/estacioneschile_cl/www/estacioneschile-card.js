/**
 * Custom Lovelace Card: Estaciones de Combustible Chile
 * Displays closest stations on a Leaflet map and dynamic table.
 */

class EstacionesChileCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.activeFuel = null;
    this.expandedStationId = null;
    this.map = null;
    this.mapInitialized = false;
    this.markers = [];
    this.skeletonInitialized = false;
    this.leafletLoading = false;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Por favor especifica la entidad (entity) del sensor en la configuración.');
    }
    this.config = config;
  }

  set hass(hass) {
    this._hass = hass;
    const entityId = this.config.entity;
    const stateObj = hass.states[entityId];

    if (!stateObj) {
      this.renderError(`Entidad no encontrada: ${entityId}`);
      return;
    }

    const attrs = stateObj.attributes;
    this.stations = attrs.stations || [];
    this.tankCapacity = attrs.tank_capacity || 50.0;
    this.prefFuel = attrs.preferred_fuel || '95';
    this.homeLat = attrs.home_latitude;
    this.homeLon = attrs.home_longitude;

    // Set active fuel to preferred if not already set manually
    if (!this.activeFuel) {
      this.activeFuel = this.prefFuel === 'Ninguno' ? '95' : this.prefFuel;
    }

    // Determine the cheapest station for the currently active fuel
    this.cheapestStationId = this.findCheapestStationId(this.activeFuel);

    // Initial setup of skeleton html structure
    this.initSkeleton();

    // Dynamically load Leaflet and initialize/update map
    this.loadAndSetupMap();

    // Render fuel tabs and stations list
    this.updateTabs();
    this.updateList();
  }

  findCheapestStationId(fuel) {
    if (!this.stations.length) return null;
    let cheapestId = null;
    let minPrice = Infinity;
    for (const s of this.stations) {
      const price = s.prices[fuel];
      if (price !== undefined && price < minPrice) {
        minPrice = price;
        cheapestId = s.id;
      }
    }
    return cheapestId;
  }

  renderError(msg) {
    this.shadowRoot.innerHTML = `
      <ha-card style="padding: 16px; color: var(--error-color);">
        <div style="font-weight: bold; margin-bottom: 8px;">Estaciones Chile Card Error</div>
        <div>${msg}</div>
      </ha-card>
    `;
  }

  initSkeleton() {
    if (this.skeletonInitialized) return;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --card-padding: 16px;
        }
        
        ha-card {
          padding: var(--card-padding);
          background: var(--ha-card-background, var(--card-background-color, #1c1c1e));
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, 0 4px 20px rgba(0, 0, 0, 0.15));
          border: 1px solid rgba(255, 255, 255, 0.05);
          display: flex;
          flex-direction: column;
          gap: 14px;
          overflow: hidden;
          font-family: var(--paper-font-body1_-_font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
        }

        .card-header {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 0;
        }

        .header-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 18px;
          font-weight: 600;
          color: var(--primary-text-color);
        }

        .header-title ha-icon {
          color: var(--primary-color);
          --mdc-icon-size: 24px;
        }

        /* Fuel tabs container */
        .fuel-tabs {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          padding-bottom: 4px;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
        }

        .fuel-tabs::-webkit-scrollbar {
          height: 3px;
        }
        .fuel-tabs::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }

        .fuel-tab {
          padding: 6px 14px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          font-size: 12px;
          font-weight: 500;
          color: var(--secondary-text-color);
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.2s ease-in-out;
        }

        .fuel-tab:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--primary-text-color);
        }

        .fuel-tab.active {
          background: linear-gradient(135deg, var(--primary-color) 0%, var(--accent-color, #ff9800) 100%);
          border-color: transparent;
          color: white;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
        }

        /* Map styling */
        .map-container {
          width: 100%;
          height: 220px;
          border-radius: 10px;
          overflow: hidden;
          position: relative;
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        #map {
          width: 100%;
          height: 100%;
          z-index: 1;
        }

        /* Station list styling */
        .stations-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 320px;
          overflow-y: auto;
          padding-right: 2px;
          scrollbar-width: thin;
        }

        .stations-list::-webkit-scrollbar {
          width: 4px;
        }
        .stations-list::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }

        .station-row {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s ease-in-out;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }

        .station-row:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(255, 255, 255, 0.08);
          transform: translateY(-1px);
        }

        .station-row.expanded {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(var(--rgb-primary-color, 3, 169, 244), 0.3);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .station-row.cheapest {
          border-left: 4px solid #4caf50;
        }

        .station-main {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .station-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          flex: 1;
        }

        /* Stylized brand icon */
        .brand-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 14px;
          color: white;
          flex-shrink: 0;
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        }

        .brand-copec {
          background: linear-gradient(135deg, #e52d27 0%, #b31010 100%);
        }

        .brand-other {
          background: linear-gradient(135deg, #7474bf 0%, #348ac7 100%);
        }

        .station-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

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
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--secondary-text-color);
          margin-top: 2px;
        }

        .distance-pill {
          background: rgba(255, 255, 255, 0.06);
          padding: 1px 6px;
          border-radius: 8px;
          font-weight: 500;
        }

        .station-right {
          display: flex;
          align-items: flex-end;
          gap: 8px;
        }

        .price-badge {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }

        .price-label {
          font-size: 9px;
          text-transform: uppercase;
          color: var(--secondary-text-color);
          letter-spacing: 0.5px;
        }

        .price-value {
          font-size: 14px;
          font-weight: bold;
          color: var(--primary-text-color);
        }

        .station-row.cheapest .price-value {
          color: #4caf50;
        }

        /* Full tank calculator badge */
        .full-tank-badge {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.1);
          border: 1px solid rgba(var(--rgb-primary-color, 3, 169, 244), 0.2);
          padding: 3px 8px;
          border-radius: 8px;
          min-width: 75px;
        }

        .full-tank-label {
          font-size: 8px;
          text-transform: uppercase;
          color: var(--primary-color);
          font-weight: 600;
        }

        .full-tank-val {
          font-size: 12px;
          font-weight: bold;
          color: var(--primary-color);
        }

        /* Expanded Details styling */
        .station-details {
          margin-top: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding-top: 10px;
          display: none;
          flex-direction: column;
          gap: 10px;
          animation: slideDown 0.2s ease-out forwards;
        }

        .station-row.expanded .station-details {
          display: flex;
        }

        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .prices-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(75px, 1fr));
          gap: 6px;
        }

        .price-item {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 6px;
          padding: 4px 6px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .price-item-label {
          font-size: 9px;
          color: var(--secondary-text-color);
        }

        .price-item-val {
          font-size: 11px;
          font-weight: bold;
          color: var(--primary-text-color);
        }

        .price-item.active-fuel-price {
          background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.06);
          border-color: rgba(var(--rgb-primary-color, 3, 169, 244), 0.2);
        }

        .amenities-section {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .section-subtitle {
          font-size: 10px;
          text-transform: uppercase;
          color: var(--secondary-text-color);
          font-weight: bold;
          letter-spacing: 0.5px;
        }

        .services-list {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }

        .service-tag {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.04);
          color: var(--primary-text-color);
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 10px;
          font-weight: 500;
        }

        /* Marker overrides for Leaflet */
        .home-marker-icon, .station-marker-icon {
          background: none !important;
          border: none !important;
        }
      </style>
      <ha-card>
        <div class="card-header">
          <div class="header-title">
            <ha-icon icon="mdi:gas-station"></ha-icon>
            <span>Estaciones de Combustible</span>
          </div>
          <div class="fuel-tabs" id="fuel-tabs"></div>
        </div>
        <div class="map-container">
          <div id="map"></div>
        </div>
        <div class="stations-list" id="stations-list"></div>
      </ha-card>
    `;
    this.skeletonInitialized = true;
  }

  loadAndSetupMap() {
    if (this.leafletLoading || this.mapInitialized) return;
    this.leafletLoading = true;

    this.loadLeaflet().then(() => {
      this.initMap();
    });
  }

  loadLeaflet() {
    return new Promise((resolve) => {
      if (window.L) {
        resolve();
        return;
      }

      // Check if another card is already loading it
      let script = document.getElementById('leaflet-js');
      if (!script) {
        script = document.createElement('script');
        script.id = 'leaflet-js';
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        document.head.appendChild(script);
        script.onload = () => resolve();
      } else {
        const interval = setInterval(() => {
          if (window.L) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      }
    });
  }

  initMap() {
    const mapEl = this.shadowRoot.getElementById('map');
    if (!mapEl) return;

    const lat = this.homeLat || -33.4489;
    const lon = this.homeLon || -70.6693;

    try {
      this.map = window.L.map(mapEl).setView([lat, lon], 13);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(this.map);

      this.mapInitialized = true;
      this.leafletLoading = false;
      
      this.updateMarkers();
    } catch (e) {
      console.error("Leaflet map initialization failed", e);
    }
  }

  updateMarkers() {
    if (!this.mapInitialized || !this.map || !window.L) return;

    // Clear old markers
    this.markers.forEach(m => this.map.removeLayer(m));
    this.markers = [];

    const lat = this.homeLat || -33.4489;
    const lon = this.homeLon || -70.6693;

    // Add home marker
    const homeIcon = window.L.divIcon({
      className: 'home-marker-icon',
      html: `<div style="background-color: #03a9f4; width: 14px; height: 14px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 8px rgba(0,0,0,0.5);"></div>`,
      iconSize: [20, 20]
    });

    const homeMarker = window.L.marker([lat, lon], { icon: homeIcon })
      .addTo(this.map)
      .bindPopup('<b>Tu Ubicación (Home)</b>');
    this.markers.push(homeMarker);

    // Add station markers
    this.stations.forEach((station, index) => {
      const isCheapest = this.cheapestStationId === station.id;
      const markerColor = isCheapest ? '#4caf50' : '#ff9800';

      const stationIcon = window.L.divIcon({
        className: 'station-marker-icon',
        html: `<div style="background-color: ${markerColor}; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 8px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; color: white; font-size: 9px; font-weight: bold;">${index + 1}</div>`,
        iconSize: [22, 22]
      });

      const price = station.prices[this.activeFuel];
      const priceText = price ? `$${price}/L` : 'N/A';

      const popupHtml = `
        <div style="font-family: sans-serif; font-size: 11px; color: #333;">
          <b style="font-size: 12px; color: #111;">#${index + 1} ${station.company}</b><br/>
          ${station.address}<br/>
          <b style="color: var(--primary-color);">${this.activeFuel}: ${priceText}</b>
        </div>
      `;

      const marker = window.L.marker([station.latitude, station.longitude], { icon: stationIcon })
        .addTo(this.map)
        .bindPopup(popupHtml);

      station.marker = marker;
      this.markers.push(marker);
    });

    // Fit map bounds
    if (this.markers.length > 1) {
      const group = new window.L.featureGroup(this.markers);
      this.map.fitBounds(group.getBounds().pad(0.1));
    }
  }

  updateTabs() {
    const tabsContainer = this.shadowRoot.getElementById('fuel-tabs');
    if (!tabsContainer) return;

    const fuels = ['93', '95', '97', 'Diesel', 'Kerosene', 'GLP', 'GNC', 'Bluemax'];
    
    tabsContainer.innerHTML = fuels.map(fuel => `
      <div class="fuel-tab ${this.activeFuel === fuel ? 'active' : ''}" data-fuel="${fuel}">
        ${fuel}
      </div>
    `).join('');

    // Attach click listeners
    const tabs = tabsContainer.querySelectorAll('.fuel-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        this.activeFuel = e.target.getAttribute('data-fuel');
        this.cheapestStationId = this.findCheapestStationId(this.activeFuel);
        this.updateTabs();
        this.updateList();
        this.updateMarkers();
      });
    });
  }

  updateList() {
    const listContainer = this.shadowRoot.getElementById('stations-list');
    if (!listContainer) return;

    if (!this.stations.length) {
      listContainer.innerHTML = `<div style="text-align: center; color: var(--secondary-text-color); font-size: 12px; padding: 20px;">No se encontraron estaciones cercanas.</div>`;
      return;
    }

    listContainer.innerHTML = this.stations.map((station, index) => {
      const isCopec = station.company.toUpperCase().includes('COPEC');
      const brandClass = isCopec ? 'brand-copec' : 'brand-other';
      const brandLetter = station.company.substring(0, 1).toUpperCase();
      
      const price = station.prices[this.activeFuel];
      const priceText = price ? `$${price}` : '--';
      
      const isExpanded = this.expandedStationId === station.id;
      const isCheapest = this.cheapestStationId === station.id;

      // Full tank calculations
      let fullTankText = '';
      if (price && this.tankCapacity) {
        const fullCost = Math.round(price * this.tankCapacity);
        fullTankText = `
          <div class="full-tank-badge">
            <span class="full-tank-label">Llenar (${this.tankCapacity}L)</span>
            <span class="full-tank-val">$${fullCost.toLocaleString('es-CL')}</span>
          </div>
        `;
      }

      // Generate grid items for all prices
      const pricesGridHtml = Object.entries(station.prices).map(([fuelType, val]) => `
        <div class="price-item ${this.activeFuel === fuelType ? 'active-fuel-price' : ''}">
          <span class="price-item-label">${fuelType}</span>
          <span class="price-item-val">$${val}</span>
        </div>
      `).join('');

      // Generate service tags
      const servicesHtml = station.services.length
        ? station.services.map(ser => `<span class="service-tag">${ser}</span>`).join('')
        : `<span class="service-tag" style="background: transparent; border: none; padding: 0;">Ninguno</span>`;

      return `
        <div class="station-row ${isExpanded ? 'expanded' : ''} ${isCheapest ? 'cheapest' : ''}" data-id="${station.id}">
          <div class="station-main">
            <div class="station-left">
              <div class="brand-icon ${brandClass}">${brandLetter}</div>
              <div class="station-info">
                <span class="station-address">${station.address}</span>
                <div class="station-meta">
                  <span style="font-weight: 600; color: var(--primary-color);">${station.company}</span>
                  <span>•</span>
                  <span>${station.comuna}</span>
                  <span>•</span>
                  <span class="distance-pill">${station.distance} km</span>
                </div>
              </div>
            </div>
            
            <div class="station-right">
              <div class="price-badge">
                <span class="price-label">${this.activeFuel} / L</span>
                <span class="price-value">${priceText}</span>
              </div>
              ${fullTankText}
            </div>
          </div>
          
          <div class="station-details">
            <div class="amenities-section">
              <span class="section-subtitle">Todos los Combustibles</span>
              <div class="prices-grid">
                ${pricesGridHtml}
              </div>
            </div>
            
            <div class="amenities-section">
              <span class="section-subtitle">Servicios y Servicios Adicionales</span>
              <div class="services-list">
                ${servicesHtml}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach click listeners to rows
    const rows = listContainer.querySelectorAll('.station-row');
    rows.forEach(row => {
      row.addEventListener('click', (e) => {
        // Prevent toggling expansion if clicking inside details elements
        if (e.target.closest('.station-details')) return;

        const id = row.getAttribute('data-id');
        const station = this.stations.find(s => s.id === id);

        if (this.expandedStationId === id) {
          this.expandedStationId = null;
        } else {
          this.expandedStationId = id;
        }
        
        this.updateList();

        // Focus station on map
        if (station && this.map && station.marker) {
          this.map.setView([station.latitude, station.longitude], 15);
          station.marker.openPopup();
        }
      });
    });
  }

  // Define dynamic card sizing for Lovelace grid
  getCardSize() {
    return 5;
  }
}

customElements.define('estacioneschile-card', EstacionesChileCard);

// Configure card details for Lovelace GUI card picker
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'estacioneschile-card',
  name: 'Estaciones de Combustible Chile',
  description: 'Muestra las estaciones chilenas más cercanas en un mapa y tabla con cotización de combustibles.',
  preview: true,
});
