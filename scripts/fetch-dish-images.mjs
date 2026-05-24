#!/usr/bin/env node
/**
 * Fetch a representative 128x128 png for each dish in data/takeaway-mock.json.
 *
 * Source chain per dish (first hit wins):
 *   1. TheMealDB free API by exact dish name
 *   2. TheMealDB by normalised name (strip parens, counts, '+ side')
 *   3. Wikipedia page-image by dish name (cleaner than commons file-search)
 *   4. Wikipedia page-image by category (Pizza, Burger, Curry, …)
 *
 * Output:
 *   data/dish-images/<slug>.png        128x128 PNG, ≤ 128 KB
 *   data/dish-images/manifest.json     dishId → { slug, source } map
 *
 * Idempotent — pngs already on disk are skipped. Delete a file to refetch.
 *
 * Run: node scripts/fetch-dish-images.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA = join(ROOT, "data");
const IMG_DIR = join(DATA, "dish-images");
const MANIFEST = join(IMG_DIR, "manifest.json");

if (!existsSync(IMG_DIR)) mkdirSync(IMG_DIR, { recursive: true });

// Wikimedia's UA policy rejects strings with "example.com" / generic defaults.
// Identify the bot with a real-looking contact instead.
const UA = "FoodyBot/0.1 (https://github.com/biztory/foody; tim.dries@biztory.be) Node.js";

function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Drop parentheticals ("(6 pcs)"), trailing piece-counts, "+ side" combos, and extra qualifiers. */
function normaliseQuery(name) {
  let s = name.normalize("NFC");
  s = s.replace(/\([^)]*\)/g, " ");      // drop parentheticals
  s = s.replace(/\bx\s*\d+\b/gi, " ");   // drop "x3"
  s = s.replace(/\b\d+\s*pcs?\b/gi, " ");// drop "6 pcs"
  s = s.replace(/\s*\+\s*\S.*$/i, "");   // drop "+ frieten" combo suffix
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Drop a noisy prefix word so "Pita Kapsalon" can fall back to "Kapsalon". */
function dropFirstWord(s) {
  const parts = s.split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : s;
}

async function fetchBuffer(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

async function searchTheMealDB(query) {
  const url = `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(query)}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();
  return data?.meals?.[0]?.strMealThumb ?? null;
}

async function wikipediaPageImage(query) {
  // First find the article, then get its lead pageimage thumb.
  const searchParams = new URLSearchParams({
    action: "query",
    format: "json",
    list: "search",
    srsearch: query,
    srlimit: "3",
    origin: "*",
  });
  const searchUrl = `https://en.wikipedia.org/w/api.php?${searchParams.toString()}`;
  const sr = await fetch(searchUrl, { headers: { "User-Agent": UA } });
  if (!sr.ok) return null;
  const sdata = await sr.json();
  const hits = sdata?.query?.search ?? [];
  for (const hit of hits) {
    const title = hit.title;
    if (!title) continue;
    const piParams = new URLSearchParams({
      action: "query",
      format: "json",
      titles: title,
      prop: "pageimages",
      piprop: "thumbnail",
      pithumbsize: "256",
      origin: "*",
    });
    const piUrl = `https://en.wikipedia.org/w/api.php?${piParams.toString()}`;
    const pr = await fetch(piUrl, { headers: { "User-Agent": UA } });
    if (!pr.ok) continue;
    const pdata = await pr.json();
    const pages = pdata?.query?.pages;
    if (!pages) continue;
    for (const p of Object.values(pages)) {
      const tn = p.thumbnail?.source;
      if (tn) return tn;
    }
  }
  return null;
}

async function findImageForDish(dish) {
  const variants = new Set([dish.name, normaliseQuery(dish.name)]);
  variants.add(dropFirstWord(normaliseQuery(dish.name)));

  for (const q of variants) {
    if (!q) continue;
    try {
      const u = await searchTheMealDB(q);
      if (u) return { url: u, source: "themealdb" };
    } catch {
      /* try next */
    }
  }
  for (const q of variants) {
    if (!q) continue;
    try {
      const u = await wikipediaPageImage(q);
      if (u) return { url: u, source: "wikipedia" };
    } catch {
      /* try next */
    }
  }
  // Category-level fallback so something always shows up.
  if (dish.category) {
    try {
      const u = await wikipediaPageImage(`${dish.category} food`);
      if (u) return { url: u, source: `wikipedia:${dish.category}` };
    } catch {
      /* fall through */
    }
  }
  return null;
}

async function processToEmoji(buf) {
  return sharp(buf)
    .resize(128, 128, { fit: "cover", position: "centre" })
    .png({ quality: 90, compressionLevel: 9 })
    .toBuffer();
}

const raw = JSON.parse(readFileSync(join(DATA, "takeaway-mock.json"), "utf-8"));
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf-8")) : {};

let fetched = 0;
let cached = 0;
let missed = 0;
const missedNames = [];

for (const dish of raw.dishes) {
  const slug = slugify(dish.name);
  const outPath = join(IMG_DIR, `${slug}.png`);

  if (existsSync(outPath)) {
    if (!manifest[dish.id]) manifest[dish.id] = { slug, source: "cached" };
    cached++;
    continue;
  }

  let result = null;
  try {
    result = await findImageForDish(dish);
  } catch (err) {
    console.warn(`  ! ${dish.name}: ${err.message}`);
  }
  if (!result) {
    missed++;
    missedNames.push(dish.name);
    continue;
  }

  try {
    const buf = await fetchBuffer(result.url);
    let png = await processToEmoji(buf);
    if (png.length > 128 * 1024) {
      png = await sharp(buf)
        .resize(96, 96, { fit: "cover" })
        .png({ quality: 75, compressionLevel: 9 })
        .toBuffer();
    }
    writeFileSync(outPath, png);
    manifest[dish.id] = { slug, source: result.source };
    fetched++;
    console.log(`  ✓ ${dish.name.padEnd(30)} ${result.source}`);
  } catch (err) {
    missed++;
    missedNames.push(`${dish.name} (download/resize: ${err.message})`);
  }

  await new Promise((r) => setTimeout(r, 1000));
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

console.log(`\nDone. fetched=${fetched} cached=${cached} missed=${missed}`);
if (missed > 0) {
  console.log(`Missed (will fall back to thematic standard emoji):`);
  for (const n of missedNames) console.log(`  - ${n}`);
}
