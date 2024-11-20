import "./leafletWorkaround.ts";
import leaflet from "leaflet";

import "leaflet/dist/leaflet.css";
import "./style.css";

import luck from "./luck.ts";

// Constants
const TILE_DEGREES = 0.0001;
const CACHE_SPAWN_PROBABILITY = 0.005;
const MOVE_DISTANCE = TILE_DEGREES;

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

const playerMarker = leaflet.marker(OAKES_CLASSROOM).bindTooltip("That's you!").addTo(map);

const movementHistory: [number, number][] = [];
const movementPolyline = leaflet.polyline([], { color: "blue" }).addTo(map);
movementHistory.push([OAKES_CLASSROOM.lat, OAKES_CLASSROOM.lng]);
movementPolyline.setLatLngs(movementHistory);

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

function getCoinId(cell: Cell): string {
  const coinId = `${cell.i}:${cell.j}#${cell.coinSerial}`;
  cell.coinIds.push(coinId);
  cell.coinSerial += 1;
  return coinId;
}

function latLngToGridCell(lat: number, lng: number): { i: number; j: number } {
  const i = Math.floor(lat / TILE_DEGREES);
  const j = Math.floor(lng / TILE_DEGREES);
  return { i, j };
}

// Cache interface and spawn function
interface Cache {
  id: string;
  lat: number;
  lng: number;
  coinValue: number;
  coinIds: string[];
  rect: leaflet.Rectangle;
  isVisible: boolean;
  toMemento(): string;
  fromMemento(memento: string): void;
}

const caches: Cache[] = [];

function spawnCache(lat: number, lng: number) {
  const { i, j } = latLngToGridCell(lat, lng);
  const cell = getOrCreateCell(i, j);

  const cacheId = `${i}:${j}`;
  let cache = caches.find((c) => c.id === cacheId);
  if (cache) {
    if (!cache.isVisible) {
      cache.rect.addTo(map);
      cache.isVisible = true;
    }
    return;
  }

  const pointValue = Math.floor(luck([i, j, "initialValue"].toString()) * 100);
  const bounds = leaflet.latLngBounds([
    [lat, lng],
    [lat + TILE_DEGREES, lng + TILE_DEGREES],
  ]);
  const rect = leaflet.rectangle(bounds).addTo(map);

  const cacheCoins: string[] = [];
  for (let k = 0; k < pointValue; k++) {
    cacheCoins.push(getCoinId(cell));
  }

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
    },
  };

  caches.push(cache);
  saveGameState();

  rect.bindPopup(() => {
    const popupDiv = document.createElement("div");
    const coinListHTML = cache.coinIds
      .map(
        (coinId) =>
          `<a href="#" class="coin-link" data-coin-id="${coinId}" data-cache-lat="${cache.lat}" data-cache-lng="${cache.lng}">${coinId}</a>`
      )
      .join(", ");
    popupDiv.innerHTML = `
      <div>Cache at "${i}:${j}". Value: <span id="value">${cache.coinValue}</span></div>
      <div>Coins: ${coinListHTML}</div>
      <button id="collect">Collect</button>
      <button id="deposit">Deposit</button>`;

    popupDiv.querySelector<HTMLButtonElement>("#collect")!.addEventListener("click", () => {
      if (cache.coinValue > 0) {
        cache.coinValue--;
        playerPoints++;
        statusPanel.innerHTML = `${playerPoints} points accumulated`;
        popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache.coinValue.toString();
        saveGameState();
      }
    });

    popupDiv.querySelector<HTMLButtonElement>("#deposit")!.addEventListener("click", () => {
      if (playerPoints > 0) {
        playerPoints--;
        cache.coinValue++;
        statusPanel.innerHTML = `${playerPoints} points accumulated`;
        popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache.coinValue.toString();
        saveGameState();
      }
    });

    return popupDiv;
  });
}

// clear out of view caches
function clearOutOfViewCaches() {
  const mapBounds = map.getBounds();

  for (const cache of caches) {
    const latLng = leaflet.latLng(cache.lat, cache.lng);
    if (!mapBounds.contains(latLng) && cache.isVisible) {
      map.removeLayer(cache.rect);
      cache.isVisible = false;
    }
  }
}


function updateCaches() {
  clearOutOfViewCaches();
  const mapBounds = map.getBounds();

  for (let lat = mapBounds.getSouth(); lat < mapBounds.getNorth(); lat += TILE_DEGREES) {
    for (let lng = mapBounds.getWest(); lng < mapBounds.getEast(); lng += TILE_DEGREES) {
      if (luck([lat, lng].toString()) < CACHE_SPAWN_PROBABILITY) {
        spawnCache(lat, lng);
      }
    }
  }
}

// Player movement 
function movePlayer(latOffset: number, lngOffset: number) {
  const currentLat = playerMarker.getLatLng().lat;
  const currentLng = playerMarker.getLatLng().lng;

  const newLat = currentLat + latOffset;
  const newLng = currentLng + lngOffset;

  playerMarker.setLatLng([newLat, newLng]);
  map.setView([newLat, newLng]);
  movementHistory.push([newLat, newLng]);
  movementPolyline.setLatLngs(movementHistory);
  updateCaches();
  saveGameState();
}

// Save/load/reset functions
function saveGameState() {
  const gameState = {
    playerPoints,
    playerPosition: playerMarker.getLatLng(),
    movementHistory,
    caches: caches.map((c) => c.toMemento()),
  };
  localStorage.setItem("gameState", JSON.stringify(gameState));
}

function loadGameState() {
  const savedState = localStorage.getItem("gameState");
  if (!savedState) return;

  const gameState = JSON.parse(savedState);
  playerPoints = gameState.playerPoints;
  playerMarker.setLatLng(gameState.playerPosition);
  map.setView(gameState.playerPosition);

  movementHistory.length = 0;
  movementHistory.push(...gameState.movementHistory);
  movementPolyline.setLatLngs(movementHistory);

  clearOutOfViewCaches();
  gameState.caches.forEach((memento: string) => {
    const cacheData = JSON.parse(memento);
    spawnCache(cacheData.lat, cacheData.lng);
  });
}

document.getElementById("north")!.addEventListener("click", () => movePlayer(MOVE_DISTANCE, 0));
document.getElementById("south")!.addEventListener("click", () => movePlayer(-MOVE_DISTANCE, 0));
document.getElementById("west")!.addEventListener("click", () => movePlayer(0, -MOVE_DISTANCE));
document.getElementById("east")!.addEventListener("click", () => movePlayer(0, MOVE_DISTANCE));
document.getElementById("reset")!.addEventListener("click", () => {
  localStorage.clear();
  location.reload();
});
