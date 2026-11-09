#!/usr/bin/env node
// End-to-end check of a built bundle, using only what the bundle ships with.
//
//   node scripts/smoke-bundle.mjs <path-to-bundle-folder>
//
// Starts the bundle with its own Node, logs in with the generated password, adds a
// "Local CLI" agent backed by a fake `claude` command, runs one session, and checks
// the agent's reply came back. On Windows the fake command is a .cmd shim, which is
// how npm installs the real CLIs, so this exercises that path too.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const bundle = path.resolve(process.argv[2] ?? "");
const isWindows = process.platform === "win32";
const PORT = 4431;
const base = `http://localhost:${PORT}`;
const REPLY = "hello-from-fake-claude";

if (!process.argv[2] || !fs.existsSync(path.join(bundle, "scripts", "local.mjs"))) {
  console.error("Usage: node scripts/smoke-bundle.mjs <bundle-folder>");
  process.exit(2);
}

// Fake CLI on PATH. The real one is never needed.
const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-cli-"));
if (isWindows) {
  fs.writeFileSync(path.join(fakeDir, "claude.cmd"), `@echo off\r\necho ${REPLY}\r\n`);
} else {
  fs.writeFileSync(path.join(fakeDir, "claude"), `#!/bin/sh\ncat > /dev/null\necho ${REPLY}\n`, { mode: 0o755 });
}

const runtime = path.join(bundle, "runtime", isWindows ? "node.exe" : "node");
const logs = [];
const child = spawn(runtime, [path.join(bundle, "scripts", "local.mjs"), "--no-open"], {
  cwd: bundle,
  env: { ...process.env, PORT: String(PORT), PATH: `${fakeDir}${path.delimiter}${process.env.PATH}` },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

function stop() {
  if (isWindows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
  fs.rmSync(fakeDir, { recursive: true, force: true });
}

function fail(message) {
  console.error(`\nSMOKE TEST FAILED: ${message}\n--- launcher output ---\n${logs.join("").slice(-3000)}`);
  stop();
  process.exit(1);
}

async function call(method, route, token, body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response;
}

try {
  // 1. Wait for the server.
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try {
      up = (await fetch(`${base}/api/health`)).ok;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!up) fail("server did not become healthy within 60s");
  console.log("ok  server healthy");

  // 2. The app shell is served.
  const page = await (await fetch(`${base}/`)).text();
  if (!page.includes("<div id=\"root\">")) fail("root page is not the app shell");
  console.log("ok  app shell served");

  // 3. Log in with the generated password.
  const envText = fs.readFileSync(path.join(bundle, "backend", ".env"), "utf8");
  const password = /^APP_PASSWORD=(.+)$/m.exec(envText)?.[1];
  if (!password) fail("no APP_PASSWORD in backend/.env");
  const login = await call("POST", "/api/auth/login", null, { username: "admin", password });
  if (!login.ok) fail(`login failed (${login.status})`);
  const { token } = await login.json();
  console.log("ok  logged in");

  // 4. A CLI agent resolves the fake command and returns its output.
  const agentRes = await call("POST", "/api/hub/agents", token, { name: "Fake Claude", provider: "cli", model: "claude" });
  if (agentRes.status !== 201) fail(`create agent failed (${agentRes.status}): ${await agentRes.text()}`);
  const { agent } = await agentRes.json();

  const sessionRes = await call("POST", "/api/hub/sessions", token, {
    goal: "Say hello.",
    agentIds: [agent.id],
    maxRounds: 1,
    synthesize: false,
  });
  if (sessionRes.status !== 201) fail(`create session failed (${sessionRes.status})`);
  const { session } = await sessionRes.json();

  const run = await call("POST", `/api/hub/sessions/${session.id}/run`, token);
  await run.text();

  const detail = await (await call("GET", `/api/hub/sessions/${session.id}`, token)).json();
  const reply = detail.messages.find((m) => m.role === "agent");
  if (!reply) fail(`no agent reply; transcript: ${JSON.stringify(detail.messages.map((m) => m.content))}`);
  if (!reply.content.includes(REPLY)) fail(`unexpected reply: ${reply.content}`);
  if (detail.session.status !== "completed") fail(`session status is ${detail.session.status}`);
  console.log(`ok  CLI agent replied: ${reply.content}`);

  console.log("\nSMOKE TEST PASSED");
  stop();
  process.exit(0);
} catch (error) {
  fail(error instanceof Error ? error.stack : String(error));
}
