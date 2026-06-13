import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { setDb } from "../src/db/index.js";
import { SqliteAdapter } from "../src/db/sqlite.js";
import { ensureSeedUser } from "../src/services/bootstrap.js";

// supertest is CJS; default-import works with esModuleInterop.
import request from "supertest";

describe("auth routes", () => {
  let app: Express;

  beforeAll(async () => {
    const db = new SqliteAdapter(":memory:");
    await db.init();
    setDb(db);
    await ensureSeedUser();
    app = createApp();
  });

  it("reports healthy", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("rejects invalid credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "testuser", password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("logs in with seeded credentials and returns a token", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "testuser", password: "testpass" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.username).toBe("testuser");
  });

  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns user info with a valid token", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ username: "testuser", password: "testpass" });

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${login.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("testuser");
  });

  it("protects the memory and settings routes", async () => {
    const memoryRes = await request(app).get("/api/memory");
    expect(memoryRes.status).toBe(401);

    const settingsRes = await request(app).get("/api/settings");
    expect(settingsRes.status).toBe(401);
  });
});
