import "./leafletWorkaround.ts";
import leaflet from "leaflet";

import "leaflet/dist/leaflet.css";
import "./style.css";

import luck from "./luck.ts";

// Constants
const TILE_DEGREES = 0.0001;
const CACHE_SPAWN_PROBABILITY = 0.005;  // probability of cache spawn
const MOVE_DISTANCE = TILE_DEGREES; // Move by one grid cell 

// Map settings
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);
const GAMEPLAY_ZOOM_LEVEL = 19;

const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES_CLASSROOM,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const playerMarker = leaflet.marker(OAKES_CLASSROOM);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

let playerPoints = 0;
const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
statusPanel.innerHTML = "No points yet...";

// Flyweight pattern for grid cells
interface Cell {
  i: number;
  j: number;
  coinSerial: number;
  coinIds: string[];
}

const cellCache: Map<string, Cell> = new Map();

function getOrCreateCell(i: number, j: number): Cell {
  const cellId = `${i}:${j}`;
  if (!cellCache.has(cellId)) {
    cellCache.set(cellId, { i, j, coinSerial: 0, coinIds: [] });
  }
  return cellCache.get(cellId)!;
}

// compact representation for coin identity
function getCoinId(cell: Cell): string {
  const coinId = `${cell.i}:${cell.j}#${cell.coinSerial}`;
  cell.coinIds.push(coinId);
  cell.coinSerial += 1;
  return coinId;
}

// Function to convert latitude and longitude to grid cell coordinates
function latLngToGridCell(lat: number, lng: number): { i: number; j: number } {
  const i = Math.floor(lat / TILE_DEGREES);
  const j = Math.floor(lng / TILE_DEGREES);
  return { i, j };
}

interface Cache {
  id: string;
  lat: number;
  lng: number;
  coinValue: number;
  coinIds: string[];
  rect: leaflet.Rectangle;
  isVisible: boolean;
  toMemento(): string;
  fromMemento(memento: string): void; // accepts a memento argument
}

const caches: Cache[] = [];

function spawnCache(lat: number, lng: number) {
  const { i, j } = latLngToGridCell(lat, lng);
  const cell = getOrCreateCell(i, j);

  const cacheId = `${i}:${j}`;

  let cache = caches.find(c => c.id === cacheId);
  if (cache) {
    
    if (!cache.isVisible) {
      cache.rect.addTo(map);
      cache.isVisible = true;
    }
    return;  
  }

  
  const pointValue = Math.floor(luck([i, j, "initialValue"].toString()) * 100);
  const bounds = leaflet.latLngBounds([[lat, lng], [lat + TILE_DEGREES, lng + TILE_DEGREES]]);
  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  const cacheCoins: string[] = [];
  for (let k = 0; k < pointValue; k++) {
    cacheCoins.push(getCoinId(cell));
  }

  // Create a new cache and store it
  cache = {
    id: cacheId,
    lat,
    lng,
    coinValue: pointValue,
    coinIds: cacheCoins,
    rect,
    isVisible: true,
    toMemento() {
      return JSON.stringify({
        id: this.id,
        lat: this.lat,
        lng: this.lng,
        coinValue: this.coinValue,
        coinIds: this.coinIds,
      });
    },
    fromMemento(memento: string) {
      const data = JSON.parse(memento);
      this.id = data.id;
      this.lat = data.lat;
      this.lng = data.lng;
      this.coinValue = data.coinValue;
      this.coinIds = data.coinIds;
    }
  };

  caches.push(cache);

  rect.bindPopup(() => {
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
      <div>Cache at "${i}:${j}". Value: <span id="value">${cache.coinValue}</span></div>
      <div>Coins: ${cache.coinIds.join(", ")}</div>
      <button id="collect">Collect</button>
      <button id="deposit">Deposit</button>`;

    // Collect button logic
    popupDiv.querySelector<HTMLButtonElement>("#collect")!.addEventListener("click", () => {
      if (cache.coinValue > 0) {
        cache.coinValue--;
        playerPoints++;
        statusPanel.innerHTML = `${playerPoints} points accumulated`;
        popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache.coinValue.toString();
      }
    });

    // Deposit button logic
    popupDiv.querySelector<HTMLButtonElement>("#deposit")!.addEventListener("click", () => {
      if (playerPoints > 0) {
        playerPoints--;
        cache.coinValue++;
        statusPanel.innerHTML = `${playerPoints} points accumulated`;
        popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache.coinValue.toString();
      }
    });

    return popupDiv;
  });
}

// Load caches from saved state (mementos)
function loadSavedCaches() {
  const savedCaches = localStorage.getItem("caches");
  if (savedCaches) {
    const mementos = JSON.parse(savedCaches);
    mementos.forEach((memento: string) => {
      const cache = {
        id: "",
        lat: 0,
        lng: 0,
        coinValue: 0,
        coinIds: [],
        rect: leaflet.rectangle([]),
        isVisible: false,
        toMemento: () => "",
        fromMemento: (memento: string) => { }  
      };
      cache.fromMemento(memento); 
      caches.push(cache);
      if (cache.isVisible) {
        cache.rect.addTo(map);
      }
    });
  }
}

// Save caches to local storage
function saveCaches() {
  const mementos = caches.filter(cache => cache.isVisible).map(cache => cache.toMemento());
  localStorage.setItem("caches", JSON.stringify(mementos));
}

// Check if the cache is within the map's visible bounds
function isCacheVisible(cache: Cache): boolean {
  const mapBounds = map.getBounds();
  const cacheBounds = leaflet.latLngBounds([
    [cache.lat, cache.lng],
    [cache.lat + TILE_DEGREES, cache.lng + TILE_DEGREES],
  ]);
  return mapBounds.intersects(cacheBounds);
}

// Remove caches that are out of view
function clearOutOfViewCaches() {
  caches.forEach((cache) => {
    if (!isCacheVisible(cache)) {
      cache.isVisible = false;
      map.removeLayer(cache.rect); 
    }
  });
}


function updateCaches() {
  
  clearOutOfViewCaches();

  // Get the current map bounds
  const mapBounds = map.getBounds();

  // Spawn new caches within the visible area
  for (let lat = mapBounds.getSouth(); lat < mapBounds.getNorth(); lat += TILE_DEGREES) {
    for (let lng = mapBounds.getWest(); lng < mapBounds.getEast(); lng += TILE_DEGREES) {
      if (luck([lat, lng].toString()) < CACHE_SPAWN_PROBABILITY) {
        spawnCache(lat, lng);
      }
    }
  }
}

// Move player and update caches
function movePlayer(latOffset: number, lngOffset: number) {
  const currentLat = playerMarker.getLatLng().lat;
  const currentLng = playerMarker.getLatLng().lng;

  
  const newLat = currentLat + latOffset;
  const newLng = currentLng + lngOffset;

  
  playerMarker.setLatLng([newLat, newLng]);
  map.setView([newLat, newLng]);

  
  updateCaches();
  saveCaches();
}

// Handle movement buttons
document.getElementById("north")!.addEventListener("click", () => {
  movePlayer(MOVE_DISTANCE, 0); 
});

document.getElementById("south")!.addEventListener("click", () => {
  movePlayer(-MOVE_DISTANCE, 0); 
});

document.getElementById("west")!.addEventListener("click", () => {
  movePlayer(0, -MOVE_DISTANCE); 
});

document.getElementById("east")!.addEventListener("click", () => {
  movePlayer(0, MOVE_DISTANCE); 
});

// Load saved caches and update periodically
loadSavedCaches();
updateCaches();
setInterval(updateCaches, 5000);
