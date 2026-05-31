import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const demoDir = join(__dirname, "..", "docs", "demo");
const sceneHtml = join(demoDir, "scene.html");
const outMp4 = join(__dirname, "..", "docs", "Foody-Demo-Video.mp4");
const VOICE = process.env.FOODY_VOICE || "Samantha";

// Each beat: how many messages to reveal + the voiceover line spoken over it.
const beats = [
  { reveal: 1, vo: "It's noon, and the team is hungry." },
  { reveal: 2, vo: "But agreeing on lunch always takes forever." },
  { reveal: 3, vo: "So today, they just call Foody." },
  { reveal: 4, vo: "Someone types: let's eat something." },
  { reveal: 5, vo: "Foody jumps in, and already knows the address." },
  { reveal: 6, vo: "Pick a cuisine. One tap." },
  { reveal: 7, vo: "Foody posts the top dishes, pre-reacted, and the whole team taps emojis to build one shared basket." },
  { reveal: 8, vo: "One tap to order, and Foody builds the basket on takeaway dot com." },
  { reveal: 9, vo: "Done. A receipt lands right in the thread." },
  { reveal: 10, vo: "Lunch, sorted in under a minute. Foody. Work hard, skip hangry." },
];

const PAD = 0.6; // seconds of silence after each line, for breathing room

function probeDur(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return parseFloat(out.toString().trim());
}

// 1) Voiceover per beat (say → aiff → wav padded with trailing silence).
console.log("Generating voiceover…");
const holds = [];
for (let i = 0; i < beats.length; i++) {
  const aiff = join(demoDir, `vo-${i}.aiff`);
  const wav = join(demoDir, `vo-${i}.wav`);
  execFileSync("say", ["-v", VOICE, "-o", aiff, beats[i].vo]);
  execFileSync("ffmpeg", ["-y", "-i", aiff, "-af", `apad=pad_dur=${PAD}`, "-ar", "44100", "-ac", "2", wav], { stdio: "ignore" });
  holds[i] = probeDur(wav);
  console.log(`  beat ${i + 1}: ${holds[i].toFixed(2)}s`);
}

// 2) One screenshot per beat.
console.log("Rendering frames…");
const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 680, deviceScaleFactor: 2 });
for (let i = 0; i < beats.length; i++) {
  await page.goto(`${pathToFileURL(sceneHtml).href}?beats=${beats[i].reveal}`, { waitUntil: "networkidle0", timeout: 60_000 });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: join(demoDir, `s-${i}.png`) });
}
await browser.close();

// 3) Concatenated narration track.
writeFileSync(join(demoDir, "audio.txt"), beats.map((_, i) => `file 'vo-${i}.wav'`).join("\n") + "\n");
execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", join(demoDir, "audio.txt"), "-c", "copy", join(demoDir, "narration.wav")], { stdio: "ignore" });

// 4) Video track — each frame held for its beat's audio duration.
const vlist = [];
for (let i = 0; i < beats.length; i++) vlist.push(`file 's-${i}.png'`, `duration ${holds[i].toFixed(3)}`);
vlist.push(`file 's-${beats.length - 1}.png'`);
writeFileSync(join(demoDir, "video.txt"), vlist.join("\n") + "\n");

// 5) Mux into an MP4 (yuv420p for universal playback).
console.log("Encoding MP4…");
execFileSync("ffmpeg", [
  "-y",
  "-f", "concat", "-safe", "0", "-i", join(demoDir, "video.txt"),
  "-i", join(demoDir, "narration.wav"),
  "-vf", "scale=1800:1360:flags=lanczos,fps=25,format=yuv420p",
  "-c:v", "libx264", "-preset", "medium", "-crf", "20",
  "-c:a", "aac", "-b:a", "160k",
  "-movflags", "+faststart", "-shortest",
  outMp4,
], { stdio: "inherit" });

console.log(`\nWrote ${outMp4}`);
