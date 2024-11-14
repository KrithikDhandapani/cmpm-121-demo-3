import "./leafletWorkaround.ts";
import leaflet from "leaflet";

import "leaflet/dist/leaflet.css";
import "./style.css";

import luck from "./luck.ts";

// Constants
const TILE_DEGREES = 0.0001;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

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

// Add map tile layer
leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// Player marker
const playerMarker = leaflet.marker(OAKES_CLASSROOM);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

// Player's collected coins
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
  coinValue: number;
  coinIds: string[];
}

const caches: Cache[] = [];

// unique coin identities
function spawnCache(lat: number, lng: number) {
  const { i, j } = latLngToGridCell(lat, lng);
  const cell = getOrCreateCell(i, j);

  const cacheId = `${i}:${j}`;
  const pointValue = Math.floor(luck([i, j, "initialValue"].toString()) * 100);

  const bounds = leaflet.latLngBounds([
    [lat, lng],
    [lat + TILE_DEGREES, lng + TILE_DEGREES],
  ]);

  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  const cacheCoins: string[] = [];
  for (let k = 0; k < pointValue; k++) {
    cacheCoins.push(getCoinId(cell));
  }

  caches.push({ id: cacheId, coinValue: pointValue, coinIds: cacheCoins });

  rect.bindPopup(() => {
    const cache = caches.find((c) => c.id === cacheId);

    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
      <div>Cache at "${i}:${j}". Value: <span id="value">${cache?.coinValue}</span></div>
      <div>Coins: ${cache?.coinIds.join(", ")}</div>
      <button id="collect">Collect</button>
      <button id="deposit">Deposit</button>`;

    // Collect button logic
    popupDiv.querySelector<HTMLButtonElement>("#collect")!.addEventListener(
      "click",
      () => {
        if (cache && cache.coinValue > 0) {
          cache.coinValue--;
          playerPoints++;
          statusPanel.innerHTML = `${playerPoints} points accumulated`;
          popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache
            .coinValue.toString();
        }
      },
    );

    // Deposit button logic
    popupDiv.querySelector<HTMLButtonElement>("#deposit")!.addEventListener(
      "click",
      () => {
        if (playerPoints > 0 && cache) {
          playerPoints--;
          cache.coinValue++;
          statusPanel.innerHTML = `${playerPoints} points accumulated`;
          popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache
            .coinValue.toString();
        }
      },
    );

    return popupDiv;
  });
}

// Generate caches around player's neighborhood
for (let di = -NEIGHBORHOOD_SIZE; di <= NEIGHBORHOOD_SIZE; di++) {
  for (let dj = -NEIGHBORHOOD_SIZE; dj <= NEIGHBORHOOD_SIZE; dj++) {
    const lat = OAKES_CLASSROOM.lat + di * TILE_DEGREES;
    const lng = OAKES_CLASSROOM.lng + dj * TILE_DEGREES;

    if (luck([di, dj].toString()) < CACHE_SPAWN_PROBABILITY) {
      spawnCache(lat, lng);
    }
  }
}
