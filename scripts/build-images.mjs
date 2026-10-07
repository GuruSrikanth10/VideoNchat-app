// Renders the PNG icons and the link-preview image from SVG and HTML, with
// the Chromium that Playwright already uses for the tests:
//   npm run images
// The output is committed, so this only needs running after a design change.
import { writeFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const OUT = new URL("../public/", import.meta.url);
const ACCENT = "#2f62e9";

// The logo's speech-bubble camera, on a 64x64 grid.
const GLYPH = `
  <path d="M12 23a7 7 0 0 1 7-7h17a7 7 0 0 1 7 7v15a7 7 0 0 1-7 7H22l-7 6a2 2 0 0 1-3-1.5z" fill="#fff"/>
  <path d="M46 27.5 53 23a1.5 1.5 0 0 1 2.3 1.3v15.4A1.5 1.5 0 0 1 53 41l-7-4.5z" fill="#fff"/>
  <circle cx="22" cy="30.5" r="2.5" fill="${ACCENT}"/>
  <circle cx="29.5" cy="30.5" r="2.5" fill="${ACCENT}"/>`;

// A full-bleed square: platforms apply their own rounding or mask. `scale`
// shrinks the glyph into the safe zone of maskable icons.
const squareIcon = (scale = 1) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">
    <rect width="64" height="64" fill="${ACCENT}"/>
    <g transform="translate(${32 - 33.6 * scale} ${32 - 33.5 * scale}) scale(${scale})">${GLYPH}</g>
  </svg>`;

const roundedIcon = () => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">
    <rect width="64" height="64" rx="16" fill="${ACCENT}"/>${GLYPH}
  </svg>`;

const page = (body, css = "") => `<!doctype html><html><head><style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; }
  svg { display: block; }
  ${css}
</style></head><body>${body}</body></html>`;

const tile = (initials, hue) => `
  <div class="tile" style="--hue: ${hue}"><span>${initials}</span></div>`;

const ogImage = page(
  `<main>
    <div class="text">
      <div class="brand">${roundedIcon()}<span>VideoNChat</span></div>
      <h1>Video meetings<br />in your browser</h1>
      <p>No downloads, no accounts.<br />Just share a link.</p>
    </div>
    <div class="grid">${tile("AL", 220)}${tile("BK", 280)}${tile("CM", 160)}${tile("DS", 30)}</div>
  </main>`,
  `
  body {
    background: radial-gradient(circle at 85% 20%, #1d3a8a 0, transparent 55%), #0f1115;
    color: #f3f5f8;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main { display: flex; align-items: center; gap: 56px; height: 100%; padding: 0 72px; box-sizing: border-box; }
  .text { flex: 1; }
  .brand { display: flex; align-items: center; gap: 20px; font-size: 40px; font-weight: 700; }
  .brand svg { width: 72px; height: 72px; }
  h1 { margin: 44px 0 20px; font-size: 68px; line-height: 1.05; letter-spacing: -1.5px; }
  p { margin: 0; color: #aab1bd; font-size: 30px; }
  .grid { display: grid; grid-template-columns: repeat(2, 200px); gap: 16px; }
  .tile {
    display: grid; place-items: center; height: 150px; border-radius: 20px;
    background: hsl(var(--hue) 25% 18%);
  }
  .tile span {
    display: grid; place-items: center; width: 72px; height: 72px; border-radius: 50%;
    background: hsl(var(--hue) 60% 55%); color: #fff; font-size: 28px; font-weight: 700;
  }`,
);

const outputs = [
  { file: "icons/icon-192.png", size: 192, html: page(roundedIcon()) },
  { file: "icons/icon-512.png", size: 512, html: page(roundedIcon()) },
  { file: "icons/icon-maskable-512.png", size: 512, html: page(squareIcon(0.62)) },
  { file: "icons/apple-touch-icon.png", size: 180, html: page(squareIcon(0.8)) },
  { file: "og.png", width: 1200, height: 630, html: ogImage },
];

const browser = await chromium.launch();
await mkdir(new URL("icons/", OUT), { recursive: true });
for (const { file, size, width = size, height = size, html } of outputs) {
  const tab = await browser.newPage({ viewport: { width, height } });
  await tab.setContent(html);
  const png = await tab.screenshot({
    omitBackground: file.includes("icon-") && !file.includes("maskable"),
  });
  await writeFile(new URL(file, OUT), png);
  await tab.close();
  console.log(`Wrote public/${file} (${width}x${height})`);
}
await browser.close();
