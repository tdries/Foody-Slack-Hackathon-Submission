import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const demoDir = join(__dirname, "..", "docs", "demo");
const htmlPath = join(demoDir, "frames.html");
const outGif = join(__dirname, "..", "docs", "Foody-Demo.gif");

// frame id → seconds to hold on screen
const sequence = [
  { id: "title", hold: 1.6 },
  { id: "0", hold: 1.8 },
  { id: "1", hold: 1.8 },
  { id: "2", hold: 1.8 },
  { id: "3", hold: 2.2 },
  { id: "4", hold: 2.0 },
  { id: "5", hold: 2.0 },
  { id: "end", hold: 2.2 },
];

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 620, deviceScaleFactor: 2 });

for (const f of sequence) {
  await page.goto(`${pathToFileURL(htmlPath).href}?frame=${f.id}`, { waitUntil: "networkidle0", timeout: 60_000 });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: join(demoDir, `f-${f.id}.png`) });
  console.log(`shot f-${f.id}.png`);
}
await browser.close();

// ffmpeg concat list (repeat last frame so its duration is honored)
const lines = [];
for (const f of sequence) {
  lines.push(`file 'f-${f.id}.png'`, `duration ${f.hold}`);
}
lines.push(`file 'f-${sequence[sequence.length - 1].id}.png'`);
const listPath = join(demoDir, "concat.txt");
writeFileSync(listPath, lines.join("\n") + "\n");

// Two-pass palette for clean, banding-free colors. Scale to 900px wide.
const vf = "fps=20,scale=900:-1:flags=lanczos";
const palette = join(demoDir, "palette.png");
execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-vf", `${vf},palettegen=stats_mode=diff`, palette], { stdio: "inherit" });
execFileSync("ffmpeg", [
  "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-i", palette,
  "-lavfi", `${vf}[x];[x][1:v]paletteuse=dither=sierra2_4a`,
  "-loop", "0", outGif,
], { stdio: "inherit" });

console.log(`\nWrote ${outGif}`);
