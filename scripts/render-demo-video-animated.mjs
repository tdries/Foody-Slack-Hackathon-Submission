import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const demoDir = join(__dirname, "..", "docs", "demo");
const sceneHtml = join(demoDir, "scene.html");
const narration = join(demoDir, "narration.mp3");
const outMp4 = join(__dirname, "..", "docs", "Foody-Demo-Video.mp4");
const FPS = 25;

// Segment boundaries, anchored to the real pauses in the ElevenLabs narration
// (validated against ffmpeg silencedetect). Each window = [start, end] in seconds.
const BOUNDS = [
  [0.00, 3.79],   // 0 Maya: starving
  [3.79, 9.01],   // 1 Tom & Dana: deciding takes forever
  [9.01, 14.10],  // 2 Maya types "let's eat something"
  [14.10, 19.15], // 3 Foody knows the address
  [19.15, 21.54], // 4 tap cuisine (Kebab)
  [21.54, 26.18], // 5 tap "See menu"
  [26.18, 31.74], // 6 empty shared basket
  [31.74, 42.73], // 7 the taps — Maya / Tom / Dana fill one basket
  [42.73, 47.91], // 8 tap "Order now" -> Foody on takeaway.com
  [47.91, 58.28], // 9 receipt lands in thread
];

function probeDur(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return parseFloat(out.toString().trim());
}

const audioDur = probeDur(narration);
const T = BOUNDS[BOUNDS.length - 1][1];
console.log(`Narration: ${audioDur.toFixed(2)}s · timeline: ${T.toFixed(2)}s · ${FPS}fps`);

function segAt(t) {
  for (let i = 0; i < BOUNDS.length; i++) {
    const [a, b] = BOUNDS[i];
    if (t < b || i === BOUNDS.length - 1) {
      const p = Math.max(0, Math.min(1, (t - a) / (b - a)));
      return [i, p];
    }
  }
  return [BOUNDS.length - 1, 1];
}

const frameDir = mkdtempSync(join(tmpdir(), "foody-frames-"));
console.log("Rendering frames…");
const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 680, deviceScaleFactor: 2 });
await page.goto(`${pathToFileURL(sceneHtml).href}?seg=0&p=0`, { waitUntil: "networkidle0", timeout: 60_000 });
await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));

const total = Math.ceil(T * FPS);
for (let f = 0; f < total; f++) {
  const t = f / FPS;
  const [seg, p] = segAt(t);
  await page.evaluate((s, pp) => window.render(s, pp), seg, p);
  await page.screenshot({ path: join(frameDir, `f-${String(f).padStart(5, "0")}.png`) });
  if (f % 50 === 0) console.log(`  ${f}/${total} (t=${t.toFixed(1)}s seg${seg})`);
}
await browser.close();

console.log("Encoding MP4…");
execFileSync("ffmpeg", [
  "-y",
  "-framerate", String(FPS),
  "-i", join(frameDir, "f-%05d.png"),
  "-i", narration,
  "-vf", "scale=1800:1360:flags=lanczos,format=yuv420p",
  "-c:v", "libx264", "-preset", "medium", "-crf", "20",
  "-c:a", "aac", "-b:a", "192k",
  "-movflags", "+faststart", "-shortest",
  outMp4,
], { stdio: "inherit" });

rmSync(frameDir, { recursive: true, force: true });
console.log(`\nWrote ${outMp4}`);
