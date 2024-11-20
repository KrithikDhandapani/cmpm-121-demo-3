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

// Set the initial movement (starting position)
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
  const bounds = leaflet.latLngBounds([[lat, lng], [lat + TILE_DEGREES, lng + TILE_DEGREES]]);
  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

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
    const coinListHTML = cache.coinIds.map((coinId) => {
      return `<a href="#" class="coin-link" data-coin-id="${coinId}" data-cache-lat="${cache.lat}" data-cache-lng="${cache.lng}">${coinId}</a>`;
    }).join(", ");
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
      
          // Save game state after collecting coin
          saveGameState(); // Ensuring the game state is saved after collecting coin
        }
      });

      popupDiv.querySelector<HTMLButtonElement>("#deposit")!.addEventListener("click", () => {
        if (playerPoints > 0) {
          playerPoints--;
          cache.coinValue++;
          statusPanel.innerHTML = `${playerPoints} points accumulated`;
          popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache.coinValue.toString();
      
          // Save game state after depositing coin
          saveGameState(); // Ensuring the game state is saved after depositing coin
        }
      });

    const coinLinks = popupDiv.querySelectorAll(".coin-link");
  coinLinks.forEach(link => {
    link.addEventListener("click", (event) => {
      const lat = parseFloat((event.target as HTMLElement).getAttribute("data-cache-lat")!);
      const lng = parseFloat((event.target as HTMLElement).getAttribute("data-cache-lng")!);
      map.setView([lat, lng], GAMEPLAY_ZOOM_LEVEL);
    });
  });

    return popupDiv;
  });
  
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

  updateCaches(); // Update the caches for the new location
  
  // Save game state after movement
  saveGameState(); // Ensuring the game state is saved here
}

function movePlayerToGeolocation(lat: number, lng: number) {
  playerMarker.setLatLng([lat, lng]);
  map.setView([lat, lng]);

  updateCaches(); // Update the caches when moving based on geolocation

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
        map.removeLayer(cache.rect); // Remove the rectangle from the map
        cache.isVisible = false; // Mark the cache as not visible
      }
    }
  }
}

function saveGameState() {
  const playerPosition = playerMarker.getLatLng();
  const gameState = {
    playerPosition: { lat: playerPosition.lat, lng: playerPosition.lng },
    playerPoints: playerPoints,
    movementHistory: movementHistory,
    caches: caches.map((cache) => ({
      id: cache.id,
      lat: cache.lat,
      lng: cache.lng,
      coinValue: cache.coinValue,
      coinIds: cache.coinIds,
      isVisible: cache.isVisible,
    })),
  };

  // Save the game state to localStorage
  localStorage.setItem("gameState", JSON.stringify(gameState));
}


function loadGameState() {
  const savedState = localStorage.getItem("gameState");
  if (savedState) {
    const gameState = JSON.parse(savedState);

    // Restore player position
    const { lat, lng } = gameState.playerPosition;
    playerMarker.setLatLng([lat, lng]);
    map.setView([lat, lng]);

    // Restore player points
    playerPoints = gameState.playerPoints;
    statusPanel.innerHTML = `${playerPoints} points accumulated`;

    // Restore movement history and polyline
    movementHistory.length = 0;  // Clear old movement history
    movementHistory.push(...gameState.movementHistory);  // Load saved history
    movementPolyline.setLatLngs(movementHistory);

    // Clear all current caches from map before loading
    caches.forEach(cache => {
      if (cache.isVisible) {
        map.removeLayer(cache.rect); // Remove old cache rectangles
        cache.isVisible = false;
      }
    });

    // Restore caches
    gameState.caches.forEach((savedCache: any) => {
      const cache = caches.find(c => c.id === savedCache.id);
      if (cache) {
        // Update the cache properties
        cache.coinValue = savedCache.coinValue;
        cache.coinIds = savedCache.coinIds;
        cache.isVisible = savedCache.isVisible;

        if (cache.isVisible) {
          const bounds = leaflet.latLngBounds([[cache.lat, cache.lng], [cache.lat + TILE_DEGREES, cache.lng + TILE_DEGREES]]);
          const rect = leaflet.rectangle(bounds);
          rect.addTo(map);
          cache.rect = rect; // Attach the rectangle to the cache
        }
      } else {
        // If the cache doesn't exist, create a new one
        spawnCache(savedCache.lat, savedCache.lng);
      }
    });
  } else {
    // If no saved state, start fresh
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

    // Optionally reset player to starting position and generate new caches
    playerMarker.setLatLng(OAKES_CLASSROOM);
    map.setView(OAKES_CLASSROOM);
    updateCaches();

    // Optionally save the initial state after reset
    saveGameState(); // Save after reset
  }
}







document.getElementById("north")!.addEventListener("click", () => movePlayer(MOVE_DISTANCE, 0));
document.getElementById("south")!.addEventListener("click", () => movePlayer(-MOVE_DISTANCE, 0));
document.getElementById("west")!.addEventListener("click", () => movePlayer(0, -MOVE_DISTANCE));
document.getElementById("east")!.addEventListener("click", () => movePlayer(0, MOVE_DISTANCE));
document.getElementById("reset")!.addEventListener("click", resetGame);
