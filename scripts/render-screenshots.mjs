import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, "..", "docs", "screenshots");
const htmlPath = join(dir, "flow.html");

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle0", timeout: 60_000 });
await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
await new Promise((r) => setTimeout(r, 400));

const shots = await page.$$("[data-shot]");
for (const el of shots) {
  const name = await el.evaluate((n) => n.getAttribute("data-shot"));
  await el.screenshot({ path: join(dir, `${name}.png`) });
  console.log(`Wrote ${name}.png`);
}
await browser.close();
