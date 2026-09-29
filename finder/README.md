# Device Finder 📍

A standalone, no-backend web app that points you toward a device you located on
**Google Find Hub** (formerly Find My Device) — or any map — and fills in the
thing Find Hub leaves out: **elevation**.

Copy a device's coordinates from Find Hub, paste them in, and you get:

- **Ground elevation** at the device (metres above sea level, in metres and
  feet) — and how far up or down it sits relative to where you're standing.
- A **live compass** that points in the real-world direction of the device and
  gives turn-by-turn guidance ("turn left 40°").
- A **3D view of your surroundings**: nearby buildings pulled from OpenStreetMap
  and extruded to scale, with your position at the centre, a marker for each
  device, and a 3D pointer arrow that tilts up or down by the elevation angle.

It's a solo [PWA](https://web.dev/progressive-web-apps/) — just static files,
installable to your home screen, and it works offline for everything except the
live location/elevation/building lookups.

## Using it

1. Open `index.html` (or the deployed URL) on your phone and allow **location**
   access. On iOS, tap **Enable compass** to grant motion/orientation access.
2. In **Google Find Hub**, open the device you want, tap its pin, and copy the
   latitude/longitude — or copy the Google Maps "share" link.
3. Paste it into **Coordinates**, give the device a name, and tap **Add device**.
   The app accepts:
   - a plain pair — `40.7128, -74.0060`
   - a Google Maps URL — `https://maps.google.com/...@40.7128,-74.0060,17z`
4. Select the device. The compass, distance, elevation, and 3D arrow update
   live as you move and turn.

Devices are saved in your browser (`localStorage`) — nothing is uploaded.

> **Note on elevation.** This is the *terrain* elevation at the device's
> coordinates (from the free, keyless [Open-Meteo elevation
> API](https://open-meteo.com/en/docs/elevation-api)). It is not the device's
> exact height off the ground — a phone on the 5th floor still reports the
> street-level terrain elevation, since Find Hub only shares a horizontal fix.

## Data sources

| What | Source | Key required |
| --- | --- | --- |
| Your position | Browser Geolocation API | — |
| Compass heading | Device Orientation API | — |
| Elevation | [Open-Meteo](https://open-meteo.com/en/docs/elevation-api) | No |
| 3D buildings | [OpenStreetMap](https://www.openstreetmap.org/) via [Overpass](https://overpass-api.de/) | No |
| 3D rendering | [Three.js](https://threejs.org/) (via CDN import map) | — |

## Development

Pure geodesy (distance, bearing, local projection, elevation angle, coordinate
parsing) lives in `geo.js` with no DOM/network dependencies, so it is unit
tested under Node:

```bash
cd finder
npm install
npm test
```

Everything degrades gracefully: if WebGL is unavailable the 3D view is skipped
but the numeric readout and 2D compass keep working; if Overpass is unreachable
the scene still renders your position, devices, and the pointer arrow.

## Files

```
finder/
├── index.html              # app shell + Three.js import map
├── app.js                  # geolocation, compass, elevation, 3D scene
├── geo.js                  # pure geodesy helpers (unit tested)
├── style.css
├── manifest.webmanifest    # PWA manifest
├── sw.js                   # offline app-shell service worker
├── icon.svg
└── __tests__/geo.test.ts   # Vitest tests for geo.js
```
