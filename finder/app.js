/*
 * Device Finder — app logic.
 *
 * A standalone (no backend, no login) tool for pointing you toward a device
 * whose coordinates you copied from Google Find Hub (Find My Device) or any
 * map. It shows the compass bearing, distance, and — the part Find Hub omits —
 * the ground elevation and how far up/down the device sits relative to you,
 * plus a live 3D view of the surrounding buildings with a pointer arrow.
 *
 * Geodesy lives in geo.js (global `GEO`); 3D rendering uses Three.js, imported
 * via the import map in index.html. Everything degrades gracefully: if WebGL
 * or the buildings API is unavailable, the numeric readout and 2D compass keep
 * working.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const GEO = window.GEO;
const ELEVATION_API = "https://api.open-meteo.com/v1/elevation";
const OVERPASS_API = "https://overpass-api.de/api/interpreter";
const BUILDING_RADIUS_M = 300; // how far out we fetch building footprints
const SCENE_RADIUS = 240; // device markers beyond this are clamped to the ring
const STORAGE_KEY = "device-finder-v1";

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  user: null, // { lat, lon, elevation, accuracy }
  heading: null, // degrees clockwise from north, or null if unknown
  devices: load() || [], // [{ id, label, lat, lon, elevation }]
  selectedId: null,
  buildingsCenter: null, // { lat, lon } the current building mesh is drawn around
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.devices));
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function selectedDevice() {
  return state.devices.find((d) => d.id === state.selectedId) || null;
}
function setStatus(msg) {
  $("status").textContent = msg;
}

// ---------------------------------------------------------------------------
// Elevation lookup (Open-Meteo, keyless). Batches several coordinates per call.
// ---------------------------------------------------------------------------
async function fetchElevations(points) {
  if (points.length === 0) return [];
  const url = new URL(ELEVATION_API);
  url.searchParams.set("latitude", points.map((p) => p.lat).join(","));
  url.searchParams.set("longitude", points.map((p) => p.lon).join(","));
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`elevation HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.elevation)) throw new Error("bad elevation response");
  return data.elevation.map((v) => (Number.isFinite(v) ? v : null));
}

/** Refresh elevation for the user + every device that is missing it. */
async function refreshElevations({ force = false } = {}) {
  const points = [];
  const targets = [];
  if (state.user && (force || state.user.elevation == null)) {
    points.push({ lat: state.user.lat, lon: state.user.lon });
    targets.push({ kind: "user" });
  }
  for (const d of state.devices) {
    if (force || d.elevation == null) {
      points.push({ lat: d.lat, lon: d.lon });
      targets.push({ kind: "device", id: d.id });
    }
  }
  if (points.length === 0) return;

  try {
    const elevations = await fetchElevations(points);
    elevations.forEach((elev, i) => {
      const t = targets[i];
      if (t.kind === "user" && state.user) state.user.elevation = elev;
      else if (t.kind === "device") {
        const dev = state.devices.find((d) => d.id === t.id);
        if (dev) dev.elevation = elev;
      }
    });
    save();
    renderDeviceList();
    updateReadout();
  } catch (err) {
    setStatus(`Elevation lookup failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------
function startGeolocation() {
  if (!("geolocation" in navigator)) {
    setStatus("Geolocation is not supported by this browser.");
    return;
  }
  setStatus("Waiting for your location…");
  navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const prev = state.user;
      const moved =
        !prev || GEO.distanceMeters(prev.lat, prev.lon, latitude, longitude) > 25;
      state.user = {
        lat: latitude,
        lon: longitude,
        accuracy,
        elevation: moved ? null : prev.elevation,
      };
      setStatus(`Located you (±${Math.round(accuracy)} m).`);
      if (moved) {
        refreshElevations();
        maybeRefreshBuildings();
      }
      updateReadout();
      updateScenePositions();
    },
    (err) => setStatus(`Location error: ${err.message}`),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

// ---------------------------------------------------------------------------
// Device orientation → compass heading
// ---------------------------------------------------------------------------
function handleOrientation(event) {
  let heading = null;
  if (typeof event.webkitCompassHeading === "number") {
    // iOS: already measured clockwise from magnetic north.
    heading = event.webkitCompassHeading;
  } else if (event.absolute && typeof event.alpha === "number") {
    // Standard: alpha is counter-clockwise from north, so invert.
    heading = 360 - event.alpha;
  }
  if (heading != null) {
    state.heading = GEO.normalizeBearing(heading);
    updateReadout();
    updateSceneHeading();
  }
}

async function enableSensors() {
  try {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      const perm = await DOE.requestPermission();
      if (perm !== "granted") {
        setStatus("Compass permission denied — bearing shown, but the dial won't turn.");
        return;
      }
    }
    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    window.addEventListener("deviceorientation", handleOrientation, true);
    $("enable-sensors").hidden = true;
    setStatus("Compass enabled. Point the top of your phone forward.");
  } catch (err) {
    setStatus(`Could not enable compass: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Numeric readout + 2D compass overlay (works even without WebGL)
// ---------------------------------------------------------------------------
function updateReadout() {
  const dev = selectedDevice();
  const nameEl = $("readout-name");
  const distEl = $("readout-distance");
  const dirEl = $("readout-direction");
  const turnEl = $("readout-turn");
  const elevEl = $("readout-elevation");

  // Rotate the north tick opposite to heading so N always shows true north.
  if (state.heading != null) {
    $("compass-dial").style.transform = `rotate(${-state.heading}deg)`;
  }

  if (!dev || !state.user) {
    nameEl.textContent = dev ? dev.label : "No device selected";
    distEl.textContent = "—";
    dirEl.textContent = "—";
    turnEl.textContent = state.user ? "Select a device" : "Waiting for your location";
    elevEl.textContent = "—";
    $("compass-arrow").style.opacity = "0.25";
    return;
  }

  const dist = GEO.distanceMeters(state.user.lat, state.user.lon, dev.lat, dev.lon);
  const brg = GEO.bearing(state.user.lat, state.user.lon, dev.lat, dev.lon);

  nameEl.textContent = dev.label;
  distEl.textContent = GEO.formatDistance(dist);
  dirEl.textContent = `${GEO.compassPoint(brg)} · ${Math.round(brg)}°`;

  // Arrow points to the bearing relative to where the phone is facing.
  const relative = state.heading != null ? brg - state.heading : brg;
  $("compass-arrow").style.opacity = "1";
  $("compass-arrow").style.transform = `rotate(${relative}deg)`;

  if (state.heading != null) {
    turnEl.textContent = GEO.relativeTurn(brg, state.heading).instruction;
  } else {
    turnEl.textContent = "Enable compass for turn-by-turn";
  }

  if (dev.elevation == null || state.user.elevation == null) {
    elevEl.textContent = "elevation loading…";
  } else {
    const delta = dev.elevation - state.user.elevation;
    const angle = GEO.elevationAngle(dist, delta);
    elevEl.textContent =
      `${Math.round(dev.elevation)} m ASL · ${GEO.formatElevationDelta(delta)} ` +
      `(${angle >= 0 ? "+" : ""}${Math.round(angle)}° look)`;
  }
}

// ---------------------------------------------------------------------------
// Device list UI
// ---------------------------------------------------------------------------
function renderDeviceList() {
  const list = $("device-list");
  list.innerHTML = "";
  if (state.devices.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No devices yet. Paste coordinates from Google Find Hub above.";
    list.appendChild(li);
    return;
  }
  for (const dev of state.devices) {
    const li = document.createElement("li");
    li.className = dev.id === state.selectedId ? "device selected" : "device";

    const main = document.createElement("button");
    main.className = "device-main";
    main.type = "button";
    const elev = dev.elevation == null ? "elev …" : `${Math.round(dev.elevation)} m`;
    main.innerHTML =
      `<span class="device-label">${escapeHtml(dev.label)}</span>` +
      `<span class="device-sub">${dev.lat.toFixed(5)}, ${dev.lon.toFixed(5)} · ${elev}</span>`;
    main.addEventListener("click", () => selectDevice(dev.id));
    li.appendChild(main);

    const del = document.createElement("button");
    del.className = "device-del";
    del.type = "button";
    del.textContent = "✕";
    del.title = "Remove device";
    del.setAttribute("aria-label", `Remove ${dev.label}`);
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removeDevice(dev.id);
    });
    li.appendChild(del);

    list.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function selectDevice(id) {
  state.selectedId = id;
  renderDeviceList();
  updateReadout();
  updateScenePositions();
}

function removeDevice(id) {
  state.devices = state.devices.filter((d) => d.id !== id);
  if (state.selectedId === id) state.selectedId = state.devices[0]?.id ?? null;
  save();
  renderDeviceList();
  updateReadout();
  updateScenePositions();
}

function addDevice(label, lat, lon) {
  const dev = { id: uid(), label: label || "Device", lat, lon, elevation: null };
  state.devices.push(dev);
  state.selectedId = dev.id;
  save();
  renderDeviceList();
  refreshElevations();
  updateReadout();
  updateScenePositions();
}

// ---------------------------------------------------------------------------
// Three.js 3D scene
// ---------------------------------------------------------------------------
const three = {
  ready: false,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  world: null, // rotates with heading; holds buildings, markers, arrow
  buildings: null,
  markers: null,
  arrow: null,
};

function initScene() {
  const mount = $("scene");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    $("no-webgl").hidden = false;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 1, 5000);
  camera.position.set(0, 190, 210);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 15, 0);
  controls.enablePan = false;
  controls.minDistance = 60;
  controls.maxDistance = 900;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x33404f, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(120, 300, 160);
  scene.add(sun);

  const world = new THREE.Group();
  scene.add(world);

  // Ground disc + a subtle grid for scale.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(SCENE_RADIUS + 40, 64),
    new THREE.MeshStandardMaterial({ color: 0x141b26, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  world.add(ground);
  const grid = new THREE.GridHelper((SCENE_RADIUS + 40) * 2, 24, 0x2a3a4f, 0x1d2938);
  grid.position.y = 0.1;
  world.add(grid);

  // Cardinal labels sit in world space so they rotate to true north on screen.
  const cardinals = [
    ["N", 0, -1, 0xff5a6e],
    ["E", 1, 0, 0x9fb4c8],
    ["S", 0, 1, 0x9fb4c8],
    ["W", -1, 0, 0x9fb4c8],
  ];
  for (const [text, ex, nz, color] of cardinals) {
    const sprite = makeTextSprite(text, color);
    sprite.position.set(ex * (SCENE_RADIUS + 20), 14, nz * (SCENE_RADIUS + 20));
    world.add(sprite);
  }

  // You: a marker at the origin.
  const you = new THREE.Mesh(
    new THREE.ConeGeometry(6, 22, 24),
    new THREE.MeshStandardMaterial({ color: 0x4ea1ff, emissive: 0x11305a })
  );
  you.position.y = 11;
  world.add(you);

  const buildings = new THREE.Group();
  world.add(buildings);
  const markers = new THREE.Group();
  world.add(markers);

  // Big pointer arrow toward the selected device.
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 26, 0),
    46,
    0xffd23f,
    16,
    10
  );
  arrow.visible = false;
  world.add(arrow);

  Object.assign(three, {
    ready: true, renderer, scene, camera, controls, world, buildings, markers, arrow,
  });

  window.addEventListener("resize", onResize);
  animate();
  updateSceneHeading();
  updateScenePositions();
}

function makeTextSprite(text, color) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.font = "bold 84px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.fillText(text, size / 2, size / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(24, 24, 1);
  return sprite;
}

/** Dispose child geometries before emptying a group, to avoid GPU leaks. */
function clearGroup(group) {
  for (const child of group.children) {
    child.geometry?.dispose?.();
  }
  group.clear();
}

function onResize() {
  if (!three.ready) return;
  const mount = $("scene");
  three.camera.aspect = mount.clientWidth / mount.clientHeight;
  three.camera.updateProjectionMatrix();
  three.renderer.setSize(mount.clientWidth, mount.clientHeight);
}

function animate() {
  if (!three.ready) return;
  requestAnimationFrame(animate);
  three.controls.update();
  three.renderer.render(three.scene, three.camera);
}

/** Rotate the world so the direction you face is "up" on screen (heading-up). */
function updateSceneHeading() {
  if (!three.ready || state.heading == null) return;
  three.world.rotation.y = GEO.toRad(state.heading);
}

/** Reposition device markers + pointer arrow for the current user/device. */
function updateScenePositions() {
  if (!three.ready || !state.user) return;
  const markers = three.markers;
  clearGroup(markers);

  const userElev = state.user.elevation ?? 0;
  let selectedTarget = null;

  for (const dev of state.devices) {
    const { east, north } = GEO.toLocalENU(dev.lat, dev.lon, state.user.lat, state.user.lon);
    const dist = Math.hypot(east, north);
    // Clamp far devices to the ring edge but keep their true direction.
    const scale = dist > SCENE_RADIUS ? SCENE_RADIUS / dist : 1;
    const x = east * scale;
    const z = -north * scale;
    const devElev = dev.elevation ?? userElev;
    const y = Math.max(6, 30 + (devElev - userElev)); // exaggerate a little for visibility

    const isSel = dev.id === state.selectedId;
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(isSel ? 9 : 6, 20, 20),
      new THREE.MeshStandardMaterial({
        color: isSel ? 0xffd23f : 0x8ad0a0,
        emissive: isSel ? 0x6b5300 : 0x1c3826,
      })
    );
    marker.position.set(x, y, z);
    markers.add(marker);

    // Stem from ground to marker.
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, y, 8),
      new THREE.MeshStandardMaterial({ color: isSel ? 0xffd23f : 0x3f5a49 })
    );
    stem.position.set(x, y / 2, z);
    markers.add(stem);

    if (isSel) selectedTarget = { east, north, devElev };
  }

  // Aim the pointer arrow (azimuth + elevation angle) at the selected device.
  if (selectedTarget) {
    const dist = GEO.distanceMeters(
      state.user.lat, state.user.lon, selectedDevice().lat, selectedDevice().lon
    );
    const delta = selectedTarget.devElev - userElev;
    const angle = GEO.toRad(GEO.elevationAngle(dist, delta));
    const horiz = Math.hypot(selectedTarget.east, selectedTarget.north) || 1;
    const dir = new THREE.Vector3(
      (selectedTarget.east / horiz) * Math.cos(angle),
      Math.sin(angle),
      (-selectedTarget.north / horiz) * Math.cos(angle)
    ).normalize();
    three.arrow.setDirection(dir);
    three.arrow.visible = true;
  } else {
    three.arrow.visible = false;
  }
}

// ---------------------------------------------------------------------------
// OpenStreetMap building footprints (Overpass), extruded to 3D
// ---------------------------------------------------------------------------
function maybeRefreshBuildings() {
  if (!state.user) return;
  const c = state.buildingsCenter;
  if (c && GEO.distanceMeters(c.lat, c.lon, state.user.lat, state.user.lon) < 120) return;
  refreshBuildings();
}

async function refreshBuildings() {
  if (!three.ready || !state.user) return;
  const { lat, lon } = state.user;
  setStatus("Loading nearby buildings…");
  const query =
    `[out:json][timeout:25];way["building"](around:${BUILDING_RADIUS_M},${lat},${lon});(._;>;);out body;`;
  try {
    const res = await fetch(OVERPASS_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const data = await res.json();
    buildBuildingMeshes(data, lat, lon);
    state.buildingsCenter = { lat, lon };
    setStatus(`Loaded ${three.buildings.children.length} nearby buildings.`);
  } catch (err) {
    setStatus(`Buildings unavailable (${err.message}). Compass still works.`);
  }
}

function buildBuildingMeshes(data, lat0, lon0) {
  const nodes = new Map();
  for (const el of data.elements) {
    if (el.type === "node") nodes.set(el.id, el);
  }
  clearGroup(three.buildings);

  const material = new THREE.MeshStandardMaterial({ color: 0x39506b, roughness: 0.85, flatShading: true });
  let count = 0;
  for (const el of data.elements) {
    if (el.type !== "way" || !el.nodes || el.nodes.length < 4) continue;
    if (count >= 800) break;
    const pts = [];
    for (const nid of el.nodes) {
      const n = nodes.get(nid);
      if (!n) break;
      const { east, north } = GEO.toLocalENU(n.lat, n.lon, lat0, lon0);
      pts.push(new THREE.Vector2(east, north));
    }
    if (pts.length < 4) continue;

    const shape = new THREE.Shape(pts);
    const height = buildingHeight(el.tags);
    let geom;
    try {
      geom = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
    } catch {
      continue;
    }
    const mesh = new THREE.Mesh(geom, material);
    mesh.rotation.x = -Math.PI / 2; // footprint to ground, extrude upward
    three.buildings.add(mesh);
    count++;
  }
}

function buildingHeight(tags = {}) {
  if (tags.height) {
    const h = parseFloat(tags.height);
    if (Number.isFinite(h) && h > 0) return h;
  }
  if (tags["building:levels"]) {
    const lv = parseFloat(tags["building:levels"]);
    if (Number.isFinite(lv) && lv > 0) return lv * 3.2;
  }
  return 6;
}

// ---------------------------------------------------------------------------
// Service worker (offline app shell)
// ---------------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// Wire up the DOM and boot
// ---------------------------------------------------------------------------
function init() {
  $("enable-sensors").addEventListener("click", enableSensors);
  $("refresh-buildings").addEventListener("click", refreshBuildings);
  $("recenter").addEventListener("click", () => {
    if (state.user && three.ready) {
      three.controls.target.set(0, 15, 0);
      three.camera.position.set(0, 190, 210);
      three.controls.update();
    }
    refreshElevations({ force: true });
  });

  $("device-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const label = $("device-label").value.trim();
    const raw = $("device-coords").value.trim();
    const parsed = GEO.parseCoordinates(raw);
    if (!parsed) {
      setStatus("Couldn't read those coordinates. Try '40.7128, -74.0060' or a Google Maps link.");
      return;
    }
    addDevice(label, parsed.lat, parsed.lon);
    $("device-label").value = "";
    $("device-coords").value = "";
  });

  renderDeviceList();
  updateReadout();
  if (state.devices.length > 0) state.selectedId = state.devices[0].id;

  // Hide the iOS "enable compass" button where it isn't needed, but always
  // attach listeners on platforms that expose orientation without a prompt.
  const DOE = window.DeviceOrientationEvent;
  if (!(DOE && typeof DOE.requestPermission === "function")) {
    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    window.addEventListener("deviceorientation", handleOrientation, true);
  }

  initScene();
  startGeolocation();
}

init();
