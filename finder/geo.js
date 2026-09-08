/*
 * Pure geodesy helpers for the Device Finder solo app.
 *
 * Nothing here touches the DOM, the network, or Three.js, so it runs equally
 * well in the browser (attached to `globalThis.GEO`) and under Node/Vitest
 * (via `module.exports`). All angles are in degrees unless noted; distances
 * are in metres.
 */
const GEO = (() => {
  const EARTH_RADIUS_M = 6371008.8; // mean Earth radius (IUGG)
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;

  const toRad = (deg) => deg * DEG;
  const toDeg = (rad) => rad * RAD;

  /** Normalise any angle to the [0, 360) range. */
  function normalizeBearing(deg) {
    return ((deg % 360) + 360) % 360;
  }

  /** Great-circle distance between two lat/lon points, in metres (haversine). */
  function distanceMeters(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Initial bearing (forward azimuth) from point 1 to point 2, in [0, 360). */
  function bearing(lat1, lon1, lat2, lon2) {
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return normalizeBearing(toDeg(Math.atan2(y, x)));
  }

  /**
   * Project a lat/lon onto a local East-North-Up tangent plane centred on
   * (lat0, lon0). Returns metres east and metres north of the origin — good
   * enough for the few-hundred-metre scenes this app renders.
   */
  function toLocalENU(lat, lon, lat0, lon0) {
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos(toRad(lat0));
    return {
      east: (lon - lon0) * metersPerDegLon,
      north: (lat - lat0) * metersPerDegLat,
    };
  }

  /**
   * Vertical look angle from an observer to a target, in degrees. Positive
   * means the target is above the observer (look up), negative below.
   */
  function elevationAngle(horizontalDistanceM, deltaElevationM) {
    if (horizontalDistanceM <= 0) {
      return deltaElevationM === 0 ? 0 : deltaElevationM > 0 ? 90 : -90;
    }
    return toDeg(Math.atan2(deltaElevationM, horizontalDistanceM));
  }

  const COMPASS_16 = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];

  /** Nearest 16-point compass label for a bearing (e.g. 200 -> "SSW"). */
  function compassPoint(deg) {
    const idx = Math.round(normalizeBearing(deg) / 22.5) % 16;
    return COMPASS_16[idx];
  }

  /**
   * Given the direction you're facing (heading) and the bearing to a target,
   * return how far and which way to turn. `delta` is signed: positive = turn
   * right (clockwise), negative = turn left, in the range (-180, 180].
   */
  function relativeTurn(bearingDeg, headingDeg) {
    let delta = normalizeBearing(bearingDeg - headingDeg);
    if (delta > 180) delta -= 360;
    let instruction;
    if (Math.abs(delta) <= 10) instruction = "straight ahead";
    else if (delta > 0) instruction = `turn right ${Math.round(delta)}°`;
    else instruction = `turn left ${Math.round(-delta)}°`;
    return { delta, instruction };
  }

  /** Human-friendly distance string (metres under 1 km, else km). */
  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "—";
    if (meters < 1000) return `${Math.round(meters)} m`;
    if (meters < 10000) return `${(meters / 1000).toFixed(2)} km`;
    return `${Math.round(meters / 1000)} km`;
  }

  /** Human-friendly signed elevation-difference string. */
  function formatElevationDelta(meters) {
    if (!Number.isFinite(meters)) return "—";
    const rounded = Math.round(meters);
    if (rounded === 0) return "level with you";
    const feet = Math.round(meters * 3.28084);
    return rounded > 0
      ? `${rounded} m (${feet} ft) above you`
      : `${-rounded} m (${-feet} ft) below you`;
  }

  /**
   * Parse coordinates a user pasted from Google Find Hub / Google Maps. Handles:
   *   "40.7128, -74.0060"      plain decimal pair
   *   "40.7128 -74.0060"       space separated
   *   Google Maps URLs containing "@lat,lon" or "q=lat,lon" or "!3dlat!4dlon"
   * Returns { lat, lon } or null if nothing valid was found.
   */
  function parseCoordinates(text) {
    if (typeof text !== "string") return null;
    const input = text.trim();
    if (!input) return null;

    const inRange = (lat, lon) =>
      Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

    // Google Maps place-marker form: !3d<lat>!4d<lon>
    const bang = input.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (bang) {
      const lat = parseFloat(bang[1]);
      const lon = parseFloat(bang[2]);
      if (inRange(lat, lon)) return { lat, lon };
    }

    // URL "@lat,lon" (map centre) or "q=lat,lon" / "query=lat,lon" / "ll=lat,lon"
    const at = input.match(/[@=](-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (at) {
      const lat = parseFloat(at[1]);
      const lon = parseFloat(at[2]);
      if (inRange(lat, lon)) return { lat, lon };
    }

    // Plain "lat, lon" or "lat lon" — take the first two signed decimals.
    const nums = input.match(/-?\d+(?:\.\d+)?/g);
    if (nums && nums.length >= 2) {
      const lat = parseFloat(nums[0]);
      const lon = parseFloat(nums[1]);
      if (inRange(lat, lon)) return { lat, lon };
    }

    return null;
  }

  return {
    EARTH_RADIUS_M,
    toRad,
    toDeg,
    normalizeBearing,
    distanceMeters,
    bearing,
    toLocalENU,
    elevationAngle,
    compassPoint,
    relativeTurn,
    formatDistance,
    formatElevationDelta,
    parseCoordinates,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = GEO;
}

// Expose to the browser. geo.js loads as a classic script, so its top-level
// `const GEO` is not a property of `window`; app.js (an ES module) reads
// `window.GEO`, so publish it explicitly here.
if (typeof window !== "undefined") {
  window.GEO = GEO;
}
