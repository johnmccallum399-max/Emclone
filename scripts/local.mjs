#!/usr/bin/env node
// One-command local launcher: first-run setup, build, start, open the browser.
// Uses only Node built-ins so it runs the same on Windows, macOS and Linux.
//
//   node scripts/local.mjs              start (set up and build first if needed)
//   node scripts/local.mjs --rebuild    rebuild backend and frontend, then start
//   node scripts/local.mjs --lan        also listen on your network (for a phone)
//   node scripts/local.mjs --no-open    do not open the browser
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = path.join(root, "backend");
const frontendDir = path.join(root, "frontend");
const envFile = path.join(backendDir, ".env");
const args = new Set(process.argv.slice(2));
const isWindows = process.platform === "win32";
const PORT = Number(process.env.PORT || 4000);

function fail(message) {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

function step(message) {
  console.log(`\n==> ${message}`);
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) fail(`Node.js 20 or newer is required (found ${process.versions.node}). Install it from https://nodejs.org`);

/** Runs a command to completion, streaming its output. npm needs a shell on Windows. */
function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit", shell: isWindows });
  if (result.status !== 0) fail(`"${command} ${commandArgs.join(" ")}" failed in ${path.relative(root, cwd) || "."}`);
}

function onPath(tool) {
  const result = spawnSync(isWindows ? "where" : "which", [tool], { stdio: "ignore", shell: isWindows });
  return result.status === 0;
}

// 1. First run: create backend/.env with generated secrets.
let generatedPassword = null;
if (!fs.existsSync(envFile)) {
  step("First run: creating backend/.env");
  generatedPassword = crypto.randomBytes(12).toString("base64url");
  const lines = [
    "# Created by scripts/local.mjs. Safe to edit. Never commit this file.",
    "NODE_ENV=production",
    `PORT=${PORT}`,
    `CORS_ORIGIN=http://localhost:${PORT}`,
    `JWT_SECRET=${crypto.randomBytes(32).toString("hex")}`,
    "APP_USERNAME=admin",
    `APP_PASSWORD=${generatedPassword}`,
    "# The base app requires a value here. Chat and voice need a real OpenAI key;",
    "# the Orchestration Hub does not use it.",
    "OPENAI_API_KEY=not-set",
    "SQLITE_PATH=./data/app.db",
    "# Lets hub agents use your signed-in Claude / Codex / Gemini CLIs.",
    "HUB_ENABLE_CLI_AGENTS=true",
    "",
  ];
  fs.writeFileSync(envFile, lines.join("\n"), { mode: 0o600 });
}

// 2. Install dependencies and build only when missing (or when --rebuild is passed).
// A downloaded bundle ships with both already done, so it needs no npm at all.
const rebuild = args.has("--rebuild");
const needsBackendBuild = rebuild || !fs.existsSync(path.join(backendDir, "dist", "index.js"));
const needsFrontendBuild = rebuild || !fs.existsSync(path.join(frontendDir, "dist", "index.html"));

// The backend needs its dependencies to run; the frontend only needs them to build.
if (rebuild || !fs.existsSync(path.join(backendDir, "node_modules"))) {
  step("Installing backend dependencies");
  run("npm", ["ci", "--no-audit", "--no-fund"], backendDir);
}
if (needsFrontendBuild && (rebuild || !fs.existsSync(path.join(frontendDir, "node_modules")))) {
  step("Installing frontend dependencies");
  run("npm", ["ci", "--no-audit", "--no-fund"], frontendDir);
}
if (needsBackendBuild) {
  step("Building backend");
  run("npm", ["run", "build"], backendDir);
}
if (needsFrontendBuild) {
  step("Building frontend");
  run("npm", ["run", "build"], frontendDir);
}

// 3. Report which vendor CLIs are available for subscription agents.
step("Checking for subscription CLIs");
for (const tool of ["claude", "codex", "gemini"]) {
  console.log(`  ${onPath(tool) ? "found  " : "missing"}  ${tool}`);
}
console.log("  (Install and sign in to a CLI to use it as a hub agent. Missing ones are fine.)");

// 4. Start the backend, serving the built frontend from the same port.
const lan = args.has("--lan");
const host = lan ? "0.0.0.0" : "127.0.0.1";
const url = `http://localhost:${PORT}`;

step(`Starting on ${host}:${PORT}`);
if (lan) {
  console.log("  LAN mode: anyone on your network can reach the login page. Use a strong password.");
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i.address}:${PORT}`);
  if (addresses.length) console.log(`  From your phone, try: ${addresses.join("  or  ")}`);
}

const server = spawn(process.execPath, ["dist/index.js"], {
  cwd: backendDir,
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, HOST: host, PORT: String(PORT), FRONTEND_DIST: path.join(frontendDir, "dist") },
});
server.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));

// 5. Wait until it answers, then show credentials and open the browser.
async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

if (!(await waitForServer())) fail(`The server did not start. Check the messages above, or backend/.env.`);

console.log(`\nReady: ${url}`);
if (generatedPassword) {
  console.log(`\nFirst-run login (shown once; also saved in backend/.env):\n  username: admin\n  password: ${generatedPassword}`);
}
console.log("\nPress Ctrl+C to stop.");

if (!args.has("--no-open")) {
  const opener = isWindows ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
}
