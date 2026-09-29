// Copies the standalone Device Finder app (repo-root /finder) into the built
// site at dist/finder so it is served at "/finder/" on the same deployment.
// Runs as a postbuild step; only the runtime files are copied (no node_modules,
// tests, or package manifests).
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const finderDir = join(here, "..", "..", "finder");
const outDir = join(here, "..", "dist", "finder");

const FILES = [
  "index.html",
  "app.js",
  "geo.js",
  "style.css",
  "manifest.webmanifest",
  "sw.js",
  "icon.svg",
];

if (!existsSync(finderDir)) {
  console.warn(`[copy-finder] source ${finderDir} not found; skipping.`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
let copied = 0;
for (const name of FILES) {
  const src = join(finderDir, name);
  if (!existsSync(src)) {
    console.warn(`[copy-finder] missing ${name}, skipping.`);
    continue;
  }
  copyFileSync(src, join(outDir, name));
  copied++;
}
console.log(`[copy-finder] copied ${copied} file(s) to dist/finder`);
