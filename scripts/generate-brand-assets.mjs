#!/usr/bin/env node
/* note-lm brand asset generator.
   Rasterizes the hand-authored SVGs in docs/design/brand into the Tauri icon
   set and preview PNGs, and assembles icon.ico as a PNG-in-ICO container.

   Tooling: playwright's chromium (already a devDependency) with a fixed
   viewport per target, deviceScaleFactor 1, transparent background, and a
   fonts-ready + double-rAF wait before capture -> deterministic output.
   The ICO container is written by hand (~40 lines, format documented
   inline): 6-byte ICONDIR + 16-byte ICONDIRENTRY per image + raw PNG blobs.
   No new dependency, no AI raster generation anywhere in the pipeline.

   Idempotent: no timestamps or nondeterministic metadata are embedded;
   two consecutive runs produce byte-identical files (compare hashes).

   Usage: node scripts/generate-brand-assets.mjs            */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'docs', 'design', 'brand');
const icons = join(root, 'src-tauri', 'icons');
const previews = join(brand, 'previews');
mkdirSync(previews, { recursive: true });
mkdirSync(icons, { recursive: true });

/* [svg source, output file, width, height] - square targets keep the mark
   honestly sized; the lockup keeps its 200x64 aspect. */
const targets = [
  [join(brand, 'icon.svg'), join(icons, 'icon.png'), 512, 512],
  [join(brand, 'icon.svg'), join(icons, '128x128@2x.png'), 256, 256],
  [join(brand, 'icon.svg'), join(icons, '128x128.png'), 128, 128],
  [join(brand, 'icon.svg'), join(icons, '32x32.png'), 32, 32],
  [join(brand, 'icon.svg'), join(previews, 'icon-16.png'), 16, 16],
  [join(brand, 'logo.svg'), join(previews, 'logo-16.png'), 16, 16],
  [join(brand, 'logo.svg'), join(previews, 'logo-32.png'), 32, 32],
  [join(brand, 'logo-wordmark.svg'), join(previews, 'lockup-640.png'), 640, 174],
  [join(brand, 'logo-wordmark-stacked.svg'), join(previews, 'lockup-stacked-400.png'), 400, 300],
  [join(brand, 'cover.svg'), join(previews, 'cover-1200.png'), 1200, 675],
];

/* Sizes embedded in icon.ico (16 and 32 for shell views, 48 for alt-tab,
   256 for large thumbnails / NSIS). */
const icoSizes = [16, 32, 48, 256];

function pageHtml(svgText, w, h) {
  // Authoring contract: brand SVGs carry viewBox only; inject exact raster
  // dimensions here so chromium lays the art out at 1:1 device pixels.
  const sized = svgText.replace('<svg ', `<svg width="${w}" height="${h}" `);
  return `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>
</head><body>${sized}</body></html>`;
}

async function render(page, svgFile, w, h) {
  const svg = readFileSync(svgFile, 'utf8');
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(pageHtml(svg, w, h), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready); // serif stack for wordmark
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.screenshot({ omitBackground: true }); // transparent except paper tiles
}

/* Minimal PNG-in-ICO writer. Format (little-endian):
   ICONDIR  : u16 reserved=0, u16 type=1 (icon), u16 count
   ENTRY[n] : u8 width (0 means 256), u8 height (0 means 256), u8 colors=0,
              u8 reserved=0, u16 planes=1, u16 bitCount=32,
              u32 bytesInRes (png length), u32 imageOffset (from file start)
   Then the PNG payloads concatenated. PNG entries are valid since Vista. */
function buildIco(pngBySize) {
  const sizes = [...pngBySize.keys()];
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const entries = Buffer.alloc(16 * sizes.length);
  let offset = header.length + entries.length;
  sizes.forEach((s, i) => {
    const png = pngBySize.get(s);
    const o = i * 16;
    entries.writeUInt8(s === 256 ? 0 : s, o);
    entries.writeUInt8(s === 256 ? 0 : s, o + 1);
    entries.writeUInt8(0, o + 2);
    entries.writeUInt8(0, o + 3);
    entries.writeUInt16LE(1, o + 4);
    entries.writeUInt16LE(32, o + 6);
    entries.writeUInt32LE(png.length, o + 8);
    entries.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, entries, ...sizes.map((s) => pngBySize.get(s))]);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });

const rel = (p) => p.replace(root + '\\', '/').replace(root + '/', '/');
const smallRasters = new Map(); // name -> Buffer, for the legibility check sheet
for (const [src, out, w, h] of targets) {
  const png = await render(page, src, w, h);
  writeFileSync(out, png);
  if (out.endsWith('logo-16.png')) smallRasters.set('logo16', png);
  if (out.endsWith('logo-32.png')) smallRasters.set('logo32', png);
  if (out.endsWith('icon-16.png')) smallRasters.set('icon16', png);
  console.log(`wrote ${rel(out)} ${w}x${h} (${png.length} bytes) <- ${rel(src)}`);
}

const icoPngs = new Map();
for (const s of icoSizes) icoPngs.set(s, await render(page, join(brand, 'icon.svg'), s, s));
const ico = buildIco(icoPngs);
writeFileSync(join(icons, 'icon.ico'), ico);
console.log(`wrote src-tauri/icons/icon.ico (${ico.length} bytes, sizes ${icoSizes.join('/')})`);

/* 16 px legibility check sheet: the exact 16/32 px rasters shown at 1x and
   enlarged 4x with image-rendering:pixelated (nearest-neighbor, so the
   enlargement shows the true pixel grid, not a re-render of the vector).
   Embeds the rasters as data URLs so setContent needs no file access. */
{
  const cell = (label, buf) => `<div class="cell">
    <img src="data:image/png;base64,${buf.toString('base64')}">
    <img class="big" src="data:image/png;base64,${buf.toString('base64')}">
    <div class="lbl">${label}</div>
  </div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#F7F6F3;font-family:ui-monospace,monospace;padding:24px}
    .row{display:flex;gap:32px;margin-bottom:28px;align-items:flex-end}
    .cell{display:flex;flex-direction:column;align-items:center;gap:8px}
    .cell img{display:block;image-rendering:pixelated}
    .big{width:128px;height:128px}
    .lbl{font-size:12px;color:#202020}
  </style></head><body>
    <div class="row">
      ${cell('logo 16', smallRasters.get('logo16'))}
      ${cell('logo 32', smallRasters.get('logo32'))}
      ${cell('app icon 16', smallRasters.get('icon16'))}
    </div>
  </body></html>`;
  await page.setViewportSize({ width: 560, height: 240 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const sheet = await page.screenshot(); // paper background baked in
  writeFileSync(join(previews, 'check-sheet.png'), sheet);
  console.log(`wrote ${rel(join(previews, 'check-sheet.png'))} (16px legibility check)`);
}
await browser.close();

/* Guard: every icon path referenced by tauri.conf.json must exist on disk. */
const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const missing = (conf.bundle?.icon ?? []).filter((p) => !existsSync(join(root, 'src-tauri', p)));
if (missing.length) {
  console.error(`FAIL: tauri.conf.json references missing icons: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`tauri.conf.json icon references OK: ${(conf.bundle?.icon ?? []).join(', ')}`);
