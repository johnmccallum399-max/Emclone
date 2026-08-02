import { env } from "../config/env.js";
import type { ToolDefinition } from "./types.js";

interface DeviceLocation {
  label?: string;
  latitude: number;
  longitude: number;
}

const MAX_LOCATIONS = 100;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates and normalizes the caller-supplied locations. Returns either the
 * parsed list or an error string suitable for returning straight to the model.
 */
function parseLocations(raw: unknown): DeviceLocation[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "Error: 'locations' must be a non-empty array of { latitude, longitude } points.";
  }
  if (raw.length > MAX_LOCATIONS) {
    return `Error: too many locations (${raw.length}). Look up at most ${MAX_LOCATIONS} at a time.`;
  }

  const locations: DeviceLocation[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as Record<string, unknown> | null;
    if (!entry || typeof entry !== "object") {
      return `Error: location ${i + 1} is not an object with latitude/longitude.`;
    }

    const latitude = typeof entry.latitude === "string" ? Number(entry.latitude) : entry.latitude;
    const longitude = typeof entry.longitude === "string" ? Number(entry.longitude) : entry.longitude;

    if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) {
      return `Error: location ${i + 1} has an invalid latitude (must be a number between -90 and 90).`;
    }
    if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) {
      return `Error: location ${i + 1} has an invalid longitude (must be a number between -180 and 180).`;
    }

    const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : undefined;
    locations.push({ label, latitude, longitude });
  }

  return locations;
}

/** Meters to feet, rounded to the nearest foot. */
function metersToFeet(meters: number): number {
  return Math.round(meters * 3.28084);
}

export const elevationTool: ToolDefinition = {
  name: "elevation",
  description:
    "Look up the ground elevation (height above sea level) at one or more geographic " +
    "coordinates. Use this to get the altitude of a device located on Google Find Hub " +
    "(Find My Device) or any map: read the device's latitude/longitude off the map and " +
    "pass them here. Accepts several devices/locations at once. Returns elevation in " +
    "both meters and feet. Note: this is the terrain elevation at that spot, not the " +
    "device's exact height off the ground (a phone on the 5th floor still reports the " +
    "street-level terrain elevation).",
  permission: "external_api",
  parameters: {
    type: "object",
    properties: {
      locations: {
        type: "array",
        description:
          "One or more locations to look up. Read each device's coordinates from Google " +
          "Find Hub (or any map) and provide them as decimal degrees.",
        minItems: 1,
        maxItems: MAX_LOCATIONS,
        items: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Optional friendly name for this device/place, e.g. 'Pixel 8' or 'Home'.",
            },
            latitude: {
              type: "number",
              description: "Latitude in decimal degrees, between -90 and 90.",
            },
            longitude: {
              type: "number",
              description: "Longitude in decimal degrees, between -180 and 180.",
            },
          },
          required: ["latitude", "longitude"],
          additionalProperties: false,
        },
      },
    },
    required: ["locations"],
    additionalProperties: false,
  },
  async execute(args) {
    const parsed = parseLocations(args.locations);
    if (typeof parsed === "string") return parsed;
    const locations = parsed;

    const url = new URL(env.ELEVATION_API_URL);
    url.searchParams.set("latitude", locations.map((l) => l.latitude).join(","));
    url.searchParams.set("longitude", locations.map((l) => l.longitude).join(","));

    let elevations: number[];
    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return `Error: elevation lookup failed with status ${response.status}.`;
      }
      const data = (await response.json()) as { elevation?: unknown };
      if (!Array.isArray(data.elevation) || data.elevation.length !== locations.length) {
        return "Error: elevation service returned an unexpected response.";
      }
      elevations = data.elevation.map((value) => (isFiniteNumber(value) ? value : Number.NaN));
    } catch (err) {
      return `Error: elevation lookup failed (${(err as Error).message}).`;
    }

    return locations
      .map((loc, i) => {
        const name = loc.label ?? `Location ${i + 1}`;
        const coords = `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`;
        const meters = elevations[i];
        if (!Number.isFinite(meters)) {
          return `${name} (${coords}): elevation unavailable for this coordinate.`;
        }
        const roundedMeters = Math.round(meters * 10) / 10;
        return `${name} (${coords}): ${roundedMeters} m (${metersToFeet(meters)} ft) above sea level.`;
      })
      .join("\n");
  },
};
