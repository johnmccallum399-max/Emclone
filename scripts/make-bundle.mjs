#!/usr/bin/env node
// Assembles a portable bundle for the machine it runs on: a copy of Node, the
// built backend with production dependencies, the built frontend and the
// launcher. Unzip it anywhere and double-click the start script; Node does not
// need to be installed.
//
//   node scripts/make-bundle.mjs <output-dir>
//
// Run it on each target OS (the database module is a native binary), after
//   backend: npm ci && npm run build && npm prune --omit=dev
//   frontend: npm ci && npm run build
// scripts/ and the CI workflow do this; see .github/workflows/hub.yml.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outParent = path.resolve(process.argv[2] || "bundle");
const isWindows = process.platform === "win32";
const target = isWindows ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const name = `ai-hub-${target}`;
const out = path.join(outParent, name);

function need(file, hint) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${path.relative(root, file)}. ${hint}`);
    process.exit(1);
  }
}

need(path.join(root, "backend", "dist", "index.js"), "Run `npm run build` in backend/ first.");
need(path.join(root, "backend", "node_modules"), "Run `npm ci` in backend/ first.");
need(path.join(root, "frontend", "dist", "index.html"), "Run `npm run build` in frontend/ first.");

if (fs.existsSync(path.join(root, "backend", "node_modules", "typescript"))) {
  console.error("backend/node_modules still has dev dependencies. Run `npm prune --omit=dev` in backend/ first.");
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "runtime"), { recursive: true });

// Node runtime: the one running this script, so it matches the compiled database module.
const nodeName = isWindows ? "node.exe" : "node";
fs.copyFileSync(process.execPath, path.join(out, "runtime", nodeName));
if (!isWindows) fs.chmodSync(path.join(out, "runtime", nodeName), 0o755);

const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true, dereference: true });
copy("backend/dist", "backend/dist");
copy("backend/package.json", "backend/package.json");
copy("backend/node_modules", "backend/node_modules");
copy("frontend/dist", "frontend/dist");
copy("scripts/local.mjs", "scripts/local.mjs");

const write = (file, content, mode) => fs.writeFileSync(path.join(out, file), content, mode ? { mode } : undefined);

if (isWindows) {
  write(
    "start-hub.bat",
    ['@echo off', 'cd /d "%~dp0"', '"%~dp0runtime\\node.exe" "%~dp0scripts\\local.mjs" %*', "if errorlevel 1 pause", ""].join("\r\n")
  );
  write(
    "README.txt",
    [
      "AI Hub (Windows)",
      "",
      "1. Double-click start-hub.bat.",
      "   If Windows shows 'Windows protected your PC', choose More info, then Run anyway.",
      "   (The files are not code-signed, so this warning is expected.)",
      "2. The first run creates your login and opens http://localhost:4000 in your browser.",
      "   The username and password are shown once and saved in backend\\.env.",
      "3. To use your Claude / ChatGPT / Gemini subscriptions, install those command-line tools",
      "   and sign in to them on this computer, then add agents of type 'Local CLI'.",
      "",
      "Updating: unzip the new version somewhere, then copy the backend folder's .env file and",
      "data folder from the old version into the new backend folder.",
      "",
      "Options: start-hub.bat --lan   (also reachable from other devices on your network)",
      "",
    ].join("\r\n")
  );
} else {
  write("start-hub.sh", '#!/usr/bin/env sh\nDIR="$(cd "$(dirname "$0")" && pwd)"\ncd "$DIR" && exec "$DIR/runtime/node" "$DIR/scripts/local.mjs" "$@"\n', 0o755);
  write(
    "add-to-menu.sh",
    [
      "#!/usr/bin/env sh",
      "# Adds an 'AI Hub' entry to your applications menu that opens a terminal and starts the hub.",
      'DIR="$(cd "$(dirname "$0")" && pwd)"',
      'mkdir -p "$HOME/.local/share/applications"',
      'cat > "$HOME/.local/share/applications/ai-hub.desktop" <<EOF',
      "[Desktop Entry]",
      "Type=Application",
      "Name=AI Hub",
      'Exec="$DIR/start-hub.sh"',
      'Path=$DIR',
      "Terminal=true",
      "Icon=utilities-terminal",
      "Categories=Utility;",
      "EOF",
      'echo "Added. Look for AI Hub in your applications menu."',
      "",
    ].join("\n"),
    0o755
  );
  write(
    "README.txt",
    [
      `AI Hub (${target})`,
      "",
      "1. In a terminal inside this folder run:  ./start-hub.sh",
      "   (Optional: ./add-to-menu.sh adds an AI Hub entry to your applications menu.)",
      "2. The first run creates your login and opens http://localhost:4000 in your browser.",
      "   The username and password are shown once and saved in backend/.env.",
      "3. To use your Claude / ChatGPT / Gemini subscriptions, install those command-line tools",
      "   and sign in to them on this computer, then add agents of type 'Local CLI'.",
      "",
      "Updating: unpack the new version somewhere, then copy backend/.env and backend/data",
      "from the old version into the new backend folder.",
      "",
      "Options: ./start-hub.sh --lan   (also reachable from other devices on your network)",
      "",
    ].join("\n")
  );
}

console.log(`Bundle ready: ${out}`);
