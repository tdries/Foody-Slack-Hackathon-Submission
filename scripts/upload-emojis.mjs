#!/usr/bin/env node
/**
 * Upload data/dish-images/*.png as Slack workspace custom emojis named
 * `foody_<slug>`, via the undocumented `emoji.add` endpoint Slack's own
 * web client uses.
 *
 * This is NOT a public API. Authentication is by a `xoxc-` user session
 * token + `d` cookie copied from your own browser. The token expires when
 * the browser session does — this script is "run once, upload batch, done",
 * not a long-running automation.
 *
 * Required env (in .env):
 *   FOODY_SLACK_TEAM_DOMAIN   — workspace subdomain, e.g. "biztory"
 *                               (the part before .slack.com in your URL)
 *   FOODY_SLACK_XOXC          — xoxc- token from Slack's browser session
 *   FOODY_SLACK_D_COOKIE      — value of the `d` cookie for slack.com
 *
 * How to extract those:
 *   1. Open <workspace>.slack.com in Chrome, log in.
 *   2. DevTools → Application → Cookies → https://app.slack.com
 *      → copy the value of `d`.
 *   3. DevTools → Console → run:
 *        JSON.parse(decodeURIComponent(window.localStorage.localConfig_v2)).teams
 *      → find the entry for your workspace → copy `token` (starts with `xoxc-`).
 *
 * The script writes back manifest.json with `uploaded: true` per dish
 * actually uploaded so the bot knows which custom emojis it can rely on.
 *
 * Run: node scripts/upload-emojis.mjs
 */
import { parseEnv } from "node:util";
import { readFileSync as _envRead } from "node:fs";
try { Object.assign(process.env, parseEnv(_envRead(".env", "utf-8"))); } catch {}
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const IMG_DIR = join(ROOT, "data", "dish-images");
const MANIFEST = join(IMG_DIR, "manifest.json");
const UPLOADED = join(IMG_DIR, "uploaded.json");

const TEAM_DOMAIN = process.env.FOODY_SLACK_TEAM_DOMAIN;
const XOXC = process.env.FOODY_SLACK_XOXC;
const D_COOKIE = process.env.FOODY_SLACK_D_COOKIE;

function bail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

if (!TEAM_DOMAIN) bail("FOODY_SLACK_TEAM_DOMAIN is required (e.g. 'biztory' for biztory.slack.com)");
if (!XOXC || !XOXC.startsWith("xoxc-")) bail("FOODY_SLACK_XOXC must be an xoxc- token");
if (!D_COOKIE) bail("FOODY_SLACK_D_COOKIE is required (the d cookie value for slack.com)");

const url = `https://${TEAM_DOMAIN}.slack.com/api/emoji.add`;

const files = readdirSync(IMG_DIR).filter((f) => f.endsWith(".png"));
const uploaded = existsSync(UPLOADED) ? JSON.parse(readFileSync(UPLOADED, "utf-8")) : {};
// Manifest only used here to validate we know about the slugs — not modified.
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf-8")) : {};
void manifest;

let uploaded = 0;
let alreadyExisted = 0;
let failed = [];

for (const file of files) {
  const slug = basename(file, ".png");
  const emojiName = `foody_${slug}`;
  const buf = readFileSync(join(IMG_DIR, file));

  const form = new FormData();
  form.append("mode", "data");
  form.append("name", emojiName);
  form.append("token", XOXC);
  form.append("image", new Blob([buf], { type: "image/png" }), file);

  let data;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Cookie: `d=${D_COOKIE}` },
      body: form,
    });
    data = await r.json();
  } catch (err) {
    failed.push({ name: emojiName, error: err.message });
    console.log(`  ✗ :${emojiName}:  ${err.message}`);
    continue;
  }

  if (data.ok) {
    uploaded++;
    console.log(`  ✓ :${emojiName}:`);
  } else if (data.error === "error_name_taken" || data.error === "error_name_taken_i18n") {
    alreadyExisted++;
    console.log(`  - :${emojiName}: already exists`);
  } else {
    failed.push({ name: emojiName, error: data.error });
    console.log(`  ✗ :${emojiName}:  ${data.error}`);
    // Auth / rate-limit failures are likely to repeat — stop early.
    if (data.error === "not_authed" || data.error === "invalid_auth" || data.error === "ratelimited") {
      console.error(`\nAborting: ${data.error}. Check token/cookie or wait and retry.`);
      break;
    }
  }

  // Mark slug as uploaded if Slack accepted it (or said it already exists).
  if (data.ok || data.error === "error_name_taken" || data.error === "error_name_taken_i18n") {
    uploaded[slug] = true;
  }

  await new Promise((r) => setTimeout(r, 250));
}

writeFileSync(UPLOADED, JSON.stringify(uploaded, null, 2) + "\n");

console.log(`\nuploaded=${uploaded} already_existed=${alreadyExisted} failed=${failed.length}`);
if (failed.length) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  ${f.name}: ${f.error}`);
}
