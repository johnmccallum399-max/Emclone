/*
 * Tests for the Device Finder app's pure geodesy helpers (finder/geo.js).
 * The file is a plain browser script, so it is evaluated in a VM sandbox
 * instead of being imported as a module (same approach as ir-remote).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const geoPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../geo.js");

interface GeoModule {
  distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number;
  bearing(lat1: number, lon1: number, lat2: number, lon2: number): number;
  toLocalENU(lat: number, lon: number, lat0: number, lon0: number): { east: number; north: number };
  elevationAngle(horizontalDistanceM: number, deltaElevationM: number): number;
  compassPoint(deg: number): string;
  normalizeBearing(deg: number): number;
  relativeTurn(bearingDeg: number, headingDeg: number): { delta: number; instruction: string };
  formatDistance(meters: number): string;
  formatElevationDelta(meters: number): string;
  parseCoordinates(text: string): { lat: number; lon: number } | null;
}

function loadGeo(): GeoModule {
  const sandbox: { module: { exports: unknown }; Math: Math } = { module: { exports: {} }, Math };
  createContext(sandbox);
  runInContext(readFileSync(geoPath, "utf8"), sandbox);
  return sandbox.module.exports as GeoModule;
}

const GEO = loadGeo();

describe("distanceMeters", () => {
  it("is zero for identical points", () => {
    expect(GEO.distanceMeters(40, -74, 40, -74)).toBe(0);
  });

  it("matches a known great-circle distance (JFK -> LAX ~3970 km)", () => {
    const d = GEO.distanceMeters(40.6413, -73.7781, 33.9416, -118.4085);
    expect(d / 1000).toBeGreaterThan(3900);
    expect(d / 1000).toBeLessThan(4000);
  });

  it("approximates one degree of latitude as ~111 km", () => {
    const d = GEO.distanceMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
});

describe("bearing", () => {
  it("is 0° due north", () => {
    expect(GEO.bearing(0, 0, 1, 0)).toBeCloseTo(0, 5);
  });

  it("is 90° due east", () => {
    expect(GEO.bearing(0, 0, 0, 1)).toBeCloseTo(90, 5);
  });

  it("is 180° due south", () => {
    expect(GEO.bearing(1, 0, 0, 0)).toBeCloseTo(180, 5);
  });

  it("is 270° due west", () => {
    expect(GEO.bearing(0, 0, 0, -1)).toBeCloseTo(270, 5);
  });
});

describe("toLocalENU", () => {
  it("returns the origin for the centre point", () => {
    const { east, north } = GEO.toLocalENU(51.5, -0.12, 51.5, -0.12);
    expect(east).toBeCloseTo(0, 6);
    expect(north).toBeCloseTo(0, 6);
  });

  it("puts a point to the north at positive north, ~0 east", () => {
    const { east, north } = GEO.toLocalENU(51.501, -0.12, 51.5, -0.12);
    expect(north).toBeGreaterThan(100);
    expect(Math.abs(east)).toBeLessThan(1);
  });

  it("shrinks east/west metres-per-degree by cos(latitude)", () => {
    const equator = GEO.toLocalENU(0, 1, 0, 0).east;
    const high = GEO.toLocalENU(60, 1, 60, 0).east;
    expect(high).toBeCloseTo(equator * Math.cos((60 * Math.PI) / 180), 0);
  });
});

describe("elevationAngle", () => {
  it("is 0 on flat ground", () => {
    expect(GEO.elevationAngle(100, 0)).toBe(0);
  });

  it("is 45° when rise equals run", () => {
    expect(GEO.elevationAngle(100, 100)).toBeCloseTo(45, 5);
  });

  it("is negative when the target is below", () => {
    expect(GEO.elevationAngle(100, -100)).toBeCloseTo(-45, 5);
  });

  it("points straight up when directly overhead", () => {
    expect(GEO.elevationAngle(0, 10)).toBe(90);
    expect(GEO.elevationAngle(0, -10)).toBe(-90);
  });
});

describe("compassPoint", () => {
  it("labels the cardinals", () => {
    expect(GEO.compassPoint(0)).toBe("N");
    expect(GEO.compassPoint(90)).toBe("E");
    expect(GEO.compassPoint(180)).toBe("S");
    expect(GEO.compassPoint(270)).toBe("W");
  });

  it("labels intercardinals and wraps at 360", () => {
    expect(GEO.compassPoint(45)).toBe("NE");
    expect(GEO.compassPoint(202.5)).toBe("SSW");
    expect(GEO.compassPoint(360)).toBe("N");
  });
});

describe("relativeTurn", () => {
  it("says straight ahead when aligned", () => {
    expect(GEO.relativeTurn(90, 90).instruction).toBe("straight ahead");
    expect(GEO.relativeTurn(95, 90).instruction).toBe("straight ahead");
  });

  it("turns right for a clockwise target", () => {
    const r = GEO.relativeTurn(120, 90);
    expect(r.delta).toBeCloseTo(30, 5);
    expect(r.instruction).toBe("turn right 30°");
  });

  it("turns left for a counter-clockwise target", () => {
    const r = GEO.relativeTurn(60, 90);
    expect(r.delta).toBeCloseTo(-30, 5);
    expect(r.instruction).toBe("turn left 30°");
  });

  it("takes the short way around past north", () => {
    const r = GEO.relativeTurn(10, 350);
    expect(r.delta).toBeCloseTo(20, 5);
    expect(r.instruction).toBe("turn right 20°");
  });
});

describe("formatDistance", () => {
  it("uses metres under 1 km", () => {
    expect(GEO.formatDistance(250)).toBe("250 m");
  });
  it("uses km with decimals in the low kilometres", () => {
    expect(GEO.formatDistance(2500)).toBe("2.50 km");
  });
  it("rounds to whole km when large", () => {
    expect(GEO.formatDistance(42000)).toBe("42 km");
  });
});

describe("formatElevationDelta", () => {
  it("describes above / below / level", () => {
    expect(GEO.formatElevationDelta(0)).toBe("level with you");
    expect(GEO.formatElevationDelta(30)).toContain("above you");
    expect(GEO.formatElevationDelta(-30)).toContain("below you");
  });
});

describe("parseCoordinates", () => {
  it("parses a plain comma pair", () => {
    expect(GEO.parseCoordinates("40.7128, -74.0060")).toEqual({ lat: 40.7128, lon: -74.006 });
  });

  it("parses a space-separated pair", () => {
    expect(GEO.parseCoordinates("51.5074 -0.1278")).toEqual({ lat: 51.5074, lon: -0.1278 });
  });

  it("parses a Google Maps @lat,lon URL", () => {
    const r = GEO.parseCoordinates("https://www.google.com/maps/@37.4219,-122.0841,17z");
    expect(r).toEqual({ lat: 37.4219, lon: -122.0841 });
  });

  it("parses a Google Maps !3d!4d place URL", () => {
    const r = GEO.parseCoordinates("https://maps.google.com/foo!3d48.8584!4d2.2945bar");
    expect(r).toEqual({ lat: 48.8584, lon: 2.2945 });
  });

  it("rejects out-of-range and junk input", () => {
    expect(GEO.parseCoordinates("200, 400")).toBeNull();
    expect(GEO.parseCoordinates("hello world")).toBeNull();
    expect(GEO.parseCoordinates("")).toBeNull();
  });
});
