import type { Express } from "express";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { setDb } from "../src/db/index.js";
import { SqliteAdapter } from "../src/db/sqlite.js";
import type { HubAgent } from "../src/db/types.js";
import { buildCliInvocation, completeWithCli, isValidCliModel, runCli } from "../src/hub/cliRunner.js";
import { completeChat } from "../src/hub/providers.js";
import { ensureSeedUser } from "../src/services/bootstrap.js";

/** A stand-in for a vendor CLI: a Node one-liner that reads stdin and prints. */
function fakeCli(script: string) {
  return { bin: process.execPath, args: ["-e", script] };
}

const ECHO = 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write("echo:"+d))';

describe("cli runner", () => {
  it("passes the prompt on stdin and returns trimmed stdout", async () => {
    const out = await runCli(fakeCli(ECHO), "hello", { timeoutMs: 10_000 });
    expect(out).toBe("echo:hello");
  });

  it("reports a non-zero exit with the CLI's own error text", async () => {
    const failing = fakeCli('process.stderr.write("not logged in");process.exit(3)');
    await expect(runCli(failing, "x", { timeoutMs: 10_000 })).rejects.toThrow(/exited with code 3: not logged in/);
  });

  it("rejects empty output instead of recording a blank turn", async () => {
    await expect(runCli(fakeCli("process.exit(0)"), "x", { timeoutMs: 10_000 })).rejects.toThrow(/returned no output/);
  });

  it("kills a CLI that exceeds the timeout", async () => {
    const hang = fakeCli("setInterval(()=>{},1000)");
    await expect(runCli(hang, "x", { timeoutMs: 300 })).rejects.toThrow(/timed out/);
  });

  it("explains a missing executable", async () => {
    await expect(
      runCli({ bin: "definitely-not-a-real-cli-xyz", args: [] }, "x", { timeoutMs: 10_000 })
    ).rejects.toThrow(/was not found on PATH/);
  });

  it("runs in an empty temporary directory, not the project", async () => {
    const out = await runCli(
      fakeCli('const fs=require("fs");process.stdout.write(process.cwd()+"|"+fs.readdirSync(".").length)'),
      "",
      { timeoutMs: 10_000 }
    );
    const [cwd, entries] = out.split("|");
    expect(cwd).toContain("hub-cli-");
    expect(entries).toBe("0");
  });

  it("does not leak API keys or app secrets to the child by default", async () => {
    const saved = { openai: process.env.OPENAI_API_KEY, jwt: process.env.JWT_SECRET };
    process.env.OPENAI_API_KEY = "sk-should-not-leak";
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-leak";
    try {
      // No env override: exercises the real scrubbing path.
      const out = await runCli(
        fakeCli(
          'const k=Object.keys(process.env).filter(k=>/KEY|SECRET|TOKEN|DATABASE/i.test(k));process.stdout.write("leaked:"+k.join(",")+";")'
        ),
        "",
        { timeoutMs: 10_000 }
      );
      expect(out).toBe("leaked:;");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      process.env.OPENAI_API_KEY = saved.openai;
      process.env.JWT_SECRET = saved.jwt;
    }
  });
});

describe("cli presets", () => {
  it("accepts only known tools with an optional model", () => {
    expect(isValidCliModel("claude")).toBe(true);
    expect(isValidCliModel("codex:gpt-5")).toBe(true);
    expect(isValidCliModel("gemini:2.5-pro")).toBe(true);
    expect(isValidCliModel("rm")).toBe(false);
    expect(isValidCliModel("claude; rm -rf /")).toBe(false);
    expect(isValidCliModel("claude:")).toBe(false);
    expect(isValidCliModel("/bin/sh")).toBe(false);
  });

  it("builds argument arrays without a shell", () => {
    expect(buildCliInvocation("claude")).toEqual({ bin: "claude", args: ["-p"] });
    expect(buildCliInvocation("claude:opus")).toEqual({ bin: "claude", args: ["-p", "--model", "opus"] });
    expect(buildCliInvocation("codex").args.at(-1)).toBe("-");
    expect(buildCliInvocation("gemini:x").args).toContain("-m");
    expect(() => buildCliInvocation("bash")).toThrow();
  });
});

describe("cli provider gating", () => {
  afterEach(() => {
    env.HUB_ENABLE_CLI_AGENTS = true;
  });

  const cliAgent = { provider: "cli", model: "claude", name: "C" } as HubAgent;

  it("refuses to run while disabled", async () => {
    env.HUB_ENABLE_CLI_AGENTS = false;
    await expect(completeWithCli("claude", { system: "s", prompt: "p" })).rejects.toThrow(/disabled/);
    await expect(completeChat(cliAgent, { system: "s", prompt: "p" })).rejects.toThrow(/disabled/);
  });
});

describe("hub agent routes with cli provider", () => {
  let app: Express;
  let auth: { Authorization: string };

  beforeAll(async () => {
    const db = new SqliteAdapter(":memory:");
    await db.init();
    setDb(db);
    await ensureSeedUser();
    app = createApp();
    const login = await request(app).post("/api/auth/login").send({ username: "testuser", password: "testpass" });
    auth = { Authorization: `Bearer ${login.body.token}` };
  });

  afterEach(() => {
    env.HUB_ENABLE_CLI_AGENTS = true;
  });

  it("creates a CLI agent without an API key", async () => {
    const res = await request(app)
      .post("/api/hub/agents")
      .set(auth)
      .send({ name: "Claude (sub)", provider: "cli", model: "claude:opus" });
    expect(res.status).toBe(201);
    expect(res.body.agent.provider).toBe("cli");
    expect(res.body.agent).not.toHaveProperty("apiKey");
    expect(res.body.agent).not.toHaveProperty("apiKeySealed");
  });

  it("rejects CLI agents when the feature is disabled", async () => {
    env.HUB_ENABLE_CLI_AGENTS = false;
    const res = await request(app)
      .post("/api/hub/agents")
      .set(auth)
      .send({ name: "Nope", provider: "cli", model: "claude" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/HUB_ENABLE_CLI_AGENTS/);
  });

  it("rejects an arbitrary command as the CLI model", async () => {
    const res = await request(app)
      .post("/api/hub/agents")
      .set(auth)
      .send({ name: "Evil", provider: "cli", model: "/bin/sh" });
    expect(res.status).toBe(400);
  });

  it("still requires an API key for API providers", async () => {
    const res = await request(app)
      .post("/api/hub/agents")
      .set(auth)
      .send({ name: "GPT", provider: "openai", model: "gpt-4o-mini" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/apiKey/);
  });

  it("refuses to switch a CLI agent to an API provider without a key", async () => {
    const created = await request(app)
      .post("/api/hub/agents")
      .set(auth)
      .send({ name: "Switcher", provider: "cli", model: "codex" });
    const res = await request(app)
      .patch(`/api/hub/agents/${created.body.agent.id}`)
      .set(auth)
      .send({ provider: "openai", model: "gpt-4o-mini" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/apiKey/);
  });
});
