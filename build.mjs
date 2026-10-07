// Assembles the Chromium (MV3) package in dist/chrome from the shared extension files
// (extract.js, reader.html, reader.js, icon.svg) plus the Chromium-specific files in chrome/.
// The Firefox/Zen package is produced separately by `npm run build` (web-ext) from extension/,
// which is itself directly loadable as a temporary add-on.
import { cp, rm, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const SHARED = ["extract.js", "reader.html", "reader.js", "icon.svg"];
const CHROME_ONLY = ["manifest.json", "background.js", "offscreen.html", "offscreen.js"];

async function buildChrome() {
  const out = path.join("dist", "chrome");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const f of SHARED) await cp(path.join("extension", f), path.join(out, f));
  for (const f of CHROME_ONLY) await cp(path.join("chrome", f), path.join(out, f));
  console.log(`Built ${out} (load unpacked in Chrome/Edge/Brave/Opera/Vivaldi).`);

  // Best-effort zip for Web Store submission. Non-fatal if no archiver is available.
  const zip = path.join("dist", "page_to_clipboard-chrome-1.1.0.zip");
  await rm(zip, { force: true });
  const ok = process.platform === "win32"
    ? spawnSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${out}/*' -DestinationPath '${zip}' -Force`], { stdio: "inherit" })
    : spawnSync("zip", ["-r", path.resolve(zip), "."], { cwd: out, stdio: "inherit" });
  if (ok.status === 0) console.log(`Wrote ${zip}`);
  else console.log(`Unpacked build is ready in ${out}; zip step skipped (no archiver found).`);
}

buildChrome().catch(error => { console.error(error); process.exit(1); });
