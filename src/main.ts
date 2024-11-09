import "./leafletWorkaround.ts";
import leaflet from "leaflet";

import "leaflet/dist/leaflet.css";
import "./style.css";

import luck from "./luck.ts";

// Constants
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 0.0001;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES_CLASSROOM,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// map
leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// player marker
const playerMarker = leaflet.marker(OAKES_CLASSROOM);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

// coins collected
let playerPoints = 0;
const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
statusPanel.innerHTML = "No points yet...";

// Cache state
interface Cache {
  id: string;
  coinValue: number;
}

const caches: Cache[] = [];

// spawn caches
function spawnCache(i: number, j: number) {
  const origin = OAKES_CLASSROOM;
  const bounds = leaflet.latLngBounds([
    [origin.lat + i * TILE_DEGREES, origin.lng + j * TILE_DEGREES],
    [origin.lat + (i + 1) * TILE_DEGREES, origin.lng + (j + 1) * TILE_DEGREES],
  ]);

  const cacheId = `${i},${j}`;
  const pointValue = Math.floor(luck([i, j, "initialValue"].toString()) * 100);

  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  caches.push({ id: cacheId, coinValue: pointValue });

  rect.bindPopup(() => {
    const cache = caches.find((c) => c.id === cacheId);

    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
      <div>There is a cache here at "${i},${j}". It has value <span id="value">${cache?.coinValue}</span>.</div>
      <button id="collect">Collect</button>
      <button id="deposit">Deposit</button>`;

    // Collect button
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

    // Deposit button
    popupDiv.querySelector<HTMLButtonElement>("#deposit")!.addEventListener(
      "click",
      () => {
        if (playerPoints > 0 && cache) {
          playerPoints--;
          cache.coinValue++;
          statusPanel.innerHTML = `${playerPoints} points accumulated`;

          popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache
            .coinValue.toString();

          map.eachLayer((layer: leaflet.Layer) => {
            if (
              layer instanceof leaflet.Rectangle &&
              layer.getPopup()?.getContent().includes(cache.id)
            ) {
              const targetPopup = layer.getPopup();
              if (targetPopup) {
                const targetPopupDiv = targetPopup.getContent() as HTMLElement;
                const targetValue = targetPopupDiv.querySelector<
                  HTMLSpanElement
                >("#value");
                if (targetValue) {
                  targetValue.innerHTML = cache.coinValue.toString();
                }
              }
            }
          });
        } else {
          alert("You don't have any coins to deposit.");
        }
      },
    );

    return popupDiv;
  });
}

// Generate caches
for (let i = -NEIGHBORHOOD_SIZE; i <= NEIGHBORHOOD_SIZE; i++) {
  for (let j = -NEIGHBORHOOD_SIZE; j <= NEIGHBORHOOD_SIZE; j++) {
    if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
      spawnCache(i, j);
    }
  }
}
