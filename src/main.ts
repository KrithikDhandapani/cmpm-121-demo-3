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

const playerMarker = leaflet.marker(OAKES_CLASSROOM);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

const movementHistory: [number, number][] = [];
const movementPolyline = leaflet.polyline([], { color: "blue" }).addTo(map);




movementHistory.push([OAKES_CLASSROOM.lat, OAKES_CLASSROOM.lng]);
movementPolyline.setLatLngs(movementHistory); // Initialize the polyline with the starting point



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

class StorageManager {
  constructor(private storage: Storage = localStorage) {}

  save(key: string, data: unknown) {
    this.storage.setItem(key, JSON.stringify(data));
  }

  load<T>(key: string): T | null {
    const savedData = this.storage.getItem(key);
    return savedData ? JSON.parse(savedData) : null;
  }

  clear(key: string) {
    this.storage.removeItem(key);
  }
}

const storageManager = new StorageManager();


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

function attachPopupListeners(popupDiv: HTMLDivElement, cache: Cache) {
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

  const coinLinks = popupDiv.querySelectorAll(".coin-link");
  coinLinks.forEach((link) =>
    link.addEventListener("click", (event) => {
      const lat = parseFloat((event.target as HTMLElement).getAttribute("data-cache-lat")!);
      const lng = parseFloat((event.target as HTMLElement).getAttribute("data-cache-lng")!);
      map.setView([lat, lng], GAMEPLAY_ZOOM_LEVEL);
    })
  );
}

function createCachePopup(cache: Cache): HTMLDivElement {
  const popupDiv = document.createElement("div");
  const coinListHTML = cache.coinIds
    .map(
      (coinId) =>
        `<a href="#" class="coin-link" data-coin-id="${coinId}" data-cache-lat="${cache.lat}" data-cache-lng="${cache.lng}">${coinId}</a>`
    )
    .join(", ");

  popupDiv.innerHTML = `
    <div>Cache at "${cache.id}". Value: <span id="value">${cache.coinValue}</span></div>
    <div>Coins: ${coinListHTML}</div>
    <button id="collect">Collect</button>
    <button id="deposit">Deposit</button>
  `;

  attachPopupListeners(popupDiv, cache);
  return popupDiv;
}

function createCache(lat: number, lng: number): Cache {
  const { i, j } = latLngToGridCell(lat, lng);
  const cell = getOrCreateCell(i, j);

  const cacheId = `${i}:${j}`;
  const pointValue = Math.floor(luck([i, j, "initialValue"].toString()) * 100);

  const bounds = leaflet.latLngBounds([[lat, lng], [lat + TILE_DEGREES, lng + TILE_DEGREES]]);
  const cacheCoins: string[] = [];
  for (let k = 0; k < pointValue; k++) {
    cacheCoins.push(getCoinId(cell));
  }

  return {
    id: cacheId,
    lat,
    lng,
    coinValue: pointValue,
    coinIds: cacheCoins,
    rect: leaflet.rectangle(bounds),
    isVisible: false, // Start as not visible
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
}

function renderCache(cache: Cache) {
  cache.rect.addTo(map);
  cache.isVisible = true;

  cache.rect.bindPopup(() => createCachePopup(cache));
}

function spawnCache(lat: number, lng: number) {
  const existingCache = caches.find((cache) => cache.lat === lat && cache.lng === lng);
  if (existingCache && existingCache.isVisible) return;

  const newCache = createCache(lat, lng);
  renderCache(newCache);
  caches.push(newCache);
  saveGameState();
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

function movePlayer(latOffset: number, lngOffset: number) {
  const currentLat = playerMarker.getLatLng().lat;
  const currentLng = playerMarker.getLatLng().lng;

  const newLat = currentLat + latOffset;
  const newLng = currentLng + lngOffset;

  playerMarker.setLatLng([newLat, newLng]);
  map.setView([newLat, newLng]);

  // Update movement history and redraw polyline
  movementHistory.push([newLat, newLng]);
  movementPolyline.setLatLngs(movementHistory);

  updateCaches();

  // Save game state after movement
  saveGameState();
}



function movePlayerToGeolocation(lat: number, lng: number) {
playerMarker.setLatLng([lat, lng]);
map.setView([lat, lng]);

  updateCaches();
  updateCaches(); 

  // Save game state after geolocation update
  saveGameState(); // Ensuring the game state is saved here
}


let geolocationWatchId: number | null = null;

const sensorButton = document.getElementById("sensor")!;
sensorButton.addEventListener("click", () => {
if (geolocationWatchId === null) {
if ("geolocation" in navigator) {
geolocationWatchId = navigator.geolocation.watchPosition(
(position) => {
const { latitude, longitude } = position.coords;
movePlayerToGeolocation(latitude, longitude);
},
(error) => {
console.error("Geolocation error:", error.message);
},
{ enableHighAccuracy: true, maximumAge: 10000 }
);
sensorButton.textContent = "🛑";
} else {
console.error("Geolocation is not available.");
}
} else {
navigator.geolocation.clearWatch(geolocationWatchId);
geolocationWatchId = null;
sensorButton.textContent = "🌐";
}
});

function clearOutOfViewCaches() {
const mapBounds = map.getBounds();

for (const cache of caches) {
const latLng = leaflet.latLng(cache.lat, cache.lng);
if (!mapBounds.contains(latLng)) {
if (cache.isVisible) {
map.removeLayer(cache.rect); 
cache.isVisible = false; 
}
}
}
}

function saveGameState() {
  const playerPosition = playerMarker.getLatLng();

  // Create memento array for caches
  const cacheMementos = caches.map((cache) => cache.toMemento());

  const gameState = {
    playerPosition: { lat: playerPosition.lat, lng: playerPosition.lng },
    playerPoints,
    movementHistory: [...movementHistory], // Save a copy of the movement history
    cacheMementos, // Store memento array
  };

  storageManager.save("gameState", gameState);
}

function loadGameState() {
  const gameState = storageManager.load<{
    playerPosition: { lat: number; lng: number };
    playerPoints: number;
    movementHistory: [number, number][];
    cacheMementos: string[];
  }>("gameState");

  if (gameState) {
    // Restore player position
    const { lat, lng } = gameState.playerPosition;
    playerMarker.setLatLng([lat, lng]);
    map.setView([lat, lng]);

    // Restore player points
    playerPoints = gameState.playerPoints;
    statusPanel.innerHTML = `${playerPoints} points accumulated`;

    // Restore movement history and polyline
    movementHistory.length = 0; // Clear the current movement history
    movementHistory.push(...gameState.movementHistory);
    movementPolyline.setLatLngs(movementHistory);

    // Clear current caches and map layers
    caches.forEach((cache) => {
      if (cache.isVisible) {
        map.removeLayer(cache.rect);
        cache.isVisible = false;
      }
    });

    caches.length = 0; // Clear the caches array

    // Restore caches using memento array
    gameState.cacheMementos.forEach((memento: string) => {
      const cacheData = JSON.parse(memento);
      spawnCache(cacheData.lat, cacheData.lng); // Recreate cache with spawnCache
    });
  } else {
    statusPanel.innerHTML = "No points yet...";
  }
}




function resetGame() {
  const userConfirmed = window.confirm("Are you sure you want to erase your game state and reset the game?");
  
  if (userConfirmed) {
    // Reset game components to initial state
    playerPoints = 0;
    statusPanel.innerHTML = `${playerPoints} points accumulated`;
    movementHistory.length = 0;
    movementPolyline.setLatLngs([]);

    caches.forEach((cache) => {
      if (cache.isVisible) {
        map.removeLayer(cache.rect);
        cache.isVisible = false;
      }
    });

    // Clear game state in localStorage
    localStorage.removeItem("gameState");

    
    playerMarker.setLatLng(OAKES_CLASSROOM);
    map.setView(OAKES_CLASSROOM);
    updateCaches();

    saveGameState(); // Save after reset
  }
}







document.getElementById("north")!.addEventListener("click", () => movePlayer(MOVE_DISTANCE, 0));
document.getElementById("south")!.addEventListener("click", () => movePlayer(-MOVE_DISTANCE, 0));
document.getElementById("west")!.addEventListener("click", () => movePlayer(0, -MOVE_DISTANCE));
document.getElementById("east")!.addEventListener("click", () => movePlayer(0, MOVE_DISTANCE));
document.getElementById("reset")!.addEventListener("click", resetGame);
