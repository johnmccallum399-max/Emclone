import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";

describe("serving the built frontend (local mode)", () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;
  const original = env.FRONTEND_DIST;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-dist-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>shell</title>");
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "assets", "app.js"), "console.log(1)");
    env.FRONTEND_DIST = dir;
    app = createApp();
  });

  afterAll(() => {
    env.FRONTEND_DIST = original;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("serves the app shell for the root and for client-side routes", async () => {
    for (const route of ["/", "/some/client/route"]) {
      const res = await request(app).get(route);
      expect(res.status).toBe(200);
      expect(res.text).toContain("<title>shell</title>");
    }
  });

  it("serves real assets", async () => {
    const res = await request(app).get("/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.text).toContain("console.log(1)");
  });

  it("returns 404 for missing files instead of the app shell", async () => {
    const res = await request(app).get("/_vercel/speed-insights/script.js");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("<title>shell</title>");
  });

  it("keeps unknown API routes as API 404s, not the app shell", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("<title>shell</title>");
  });

  it("does not tell browsers to upgrade plain-HTTP asset requests to HTTPS", async () => {
    const res = await request(app).get("/");
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});
