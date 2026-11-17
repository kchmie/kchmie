// Run after `npm run build`. Captures the real Card page, including its current CSS.
import { preview } from 'astro';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import config from '../astro.config.mjs';

const root = new URL('../', import.meta.url);
const outDir = new URL(config.outDir ?? './dist/', root);
const base = (config.base ?? '/').replace(/\/$/, '');
const output = new URL('profile-card.png', outDir);
let server;
let browser;

try {
  server = await preview({
    root: fileURLToPath(root),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, open: false },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400 && ['stylesheet', 'font', 'image', 'script'].includes(response.request().resourceType())) {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });
  const response = await page.goto(`http://127.0.0.1:${server.port}${base}/card/`, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`Card page returned HTTP ${response?.status() ?? 'no response'}.`);

  const card = page.locator('.profile-card');
  await card.waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.decode()));
  });
  if (failures.length) throw new Error(`Card rendering failed:\n${failures.join('\n')}`);

  const { radius, width } = await card.evaluate((element) => ({
    radius: parseFloat(getComputedStyle(element).borderTopLeftRadius),
    width: element.getBoundingClientRect().width,
  }));
  const screenshot = await card.screenshot({ animations: 'disabled' });
  const { width: imageWidth, height: imageHeight } = await sharp(screenshot).metadata();
  if (!imageWidth || !imageHeight) throw new Error('Card screenshot is empty.');

  // Keep the card corners transparent when embedded on light or dark GitHub themes.
  const imageRadius = radius * imageWidth / width;
  const mask = Buffer.from(`<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="${imageWidth}" height="${imageHeight}" rx="${imageRadius}" fill="white"/></svg>`);
  const png = await sharp(screenshot).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  await mkdir(outDir, { recursive: true });
  await writeFile(output, png);
  console.log(`Generated ${fileURLToPath(output)} (${imageWidth} × ${imageHeight}).`);
} finally {
  try {
    await browser?.close();
  } finally {
    await server?.stop();
  }
}
