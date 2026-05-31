import { dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docs = join(__dirname, "..", "docs");

// Usage: node scripts/render-one-pager.mjs [input.html] [output.pdf]
// Defaults to the commercial one-pager.
const inputArg = process.argv[2] ?? "foody-one-pager.html";
const htmlPath = inputArg.includes("/") ? inputArg : join(docs, inputArg);
const defaultOut = basename(htmlPath).replace(/\.html?$/i, "") + ".pdf";
const pdfArg = process.argv[3] ?? defaultOut;
const pdfPath = pdfArg.includes("/") ? pdfArg : join(docs, pdfArg);

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle0", timeout: 60_000 });
// Give web fonts a beat to settle so the PDF uses Poppins/Inter, not fallbacks.
await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
await new Promise((r) => setTimeout(r, 400));
await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
});
await browser.close();
console.log(`Wrote ${pdfPath}`);
