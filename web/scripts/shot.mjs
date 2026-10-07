// Headless screenshot of a page on the dev server (WebGL via SwiftShader), for checking the engine by eye.
// node scripts/shot.mjs <url> <out.png> [wait ms] [width] [height]
import { chromium } from 'playwright';

const [url, out, wait, w, h] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ozone-platform=headless'],
  env: { ...process.env, DISPLAY: '' }, // a dead WSLg display makes SwiftShader fail (xcb_connect)
});
const page = await browser.newPage({ viewport: { width: Number(w || 1440), height: Number(h || 900) } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(wait || 20000));
await page.screenshot({ path: out });
await browser.close();
