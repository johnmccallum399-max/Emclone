import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elevationTool } from "../src/tools/elevation.js";

const originalFetch = globalThis.fetch;

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("elevation tool", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns elevation in meters and feet for a single location", async () => {
    mockFetchOnce({ elevation: [100] });
    const result = await elevationTool.execute(
      { locations: [{ label: "Pixel 8", latitude: 40.7128, longitude: -74.006 }] },
      { userId: 1 }
    );
    expect(result).toContain("Pixel 8");
    expect(result).toContain("40.71280, -74.00600");
    expect(result).toContain("100 m");
    expect(result).toContain("328 ft"); // 100m * 3.28084 rounded
    expect(result).toContain("above sea level");
  });

  it("sends batched, comma-separated coordinates to the API", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ elevation: [10, 20] }) }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await elevationTool.execute(
      {
        locations: [
          { label: "A", latitude: 1, longitude: 2 },
          { label: "B", latitude: 3, longitude: 4 },
        ],
      },
      { userId: 1 }
    );

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("latitude=1%2C3");
    expect(calledUrl).toContain("longitude=2%2C4");
  });

  it("labels multiple devices independently", async () => {
    mockFetchOnce({ elevation: [5.4, 250.8] });
    const result = await elevationTool.execute(
      {
        locations: [
          { label: "Home", latitude: 51.5, longitude: -0.12 },
          { label: "Cabin", latitude: 46.8, longitude: 8.2 },
        ],
      },
      { userId: 1 }
    );
    expect(result).toMatch(/Home .*: 5.4 m/);
    expect(result).toMatch(/Cabin .*: 250.8 m/);
  });

  it("falls back to a generic label when none is given", async () => {
    mockFetchOnce({ elevation: [42] });
    const result = await elevationTool.execute(
      { locations: [{ latitude: 10, longitude: 20 }] },
      { userId: 1 }
    );
    expect(result).toContain("Location 1");
  });

  it("rejects an empty locations array without calling the API", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await elevationTool.execute({ locations: [] }, { userId: 1 });
    expect(result).toMatch(/non-empty array/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects out-of-range coordinates", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const latResult = await elevationTool.execute(
      { locations: [{ latitude: 200, longitude: 0 }] },
      { userId: 1 }
    );
    expect(latResult).toMatch(/invalid latitude/);

    const lonResult = await elevationTool.execute(
      { locations: [{ latitude: 0, longitude: 999 }] },
      { userId: 1 }
    );
    expect(lonResult).toMatch(/invalid longitude/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("coerces numeric strings from the model", async () => {
    mockFetchOnce({ elevation: [15] });
    const result = await elevationTool.execute(
      { locations: [{ latitude: "12.5", longitude: "-3.25" }] },
      { userId: 1 }
    );
    expect(result).toContain("12.50000, -3.25000");
    expect(result).toContain("15 m");
  });

  it("reports an API failure gracefully", async () => {
    mockFetchOnce({}, false, 503);
    const result = await elevationTool.execute(
      { locations: [{ latitude: 1, longitude: 1 }] },
      { userId: 1 }
    );
    expect(result).toMatch(/failed with status 503/);
  });

  it("handles a malformed API response", async () => {
    mockFetchOnce({ nope: true });
    const result = await elevationTool.execute(
      { locations: [{ latitude: 1, longitude: 1 }] },
      { userId: 1 }
    );
    expect(result).toMatch(/unexpected response/);
  });

  it("marks an individual coordinate whose elevation is unavailable", async () => {
    mockFetchOnce({ elevation: [null] });
    const result = await elevationTool.execute(
      { locations: [{ label: "Sea", latitude: 0, longitude: 0 }] },
      { userId: 1 }
    );
    expect(result).toMatch(/elevation unavailable/);
  });
});
