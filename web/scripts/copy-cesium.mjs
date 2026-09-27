// Copies Cesium's static runtime (workers, widgets, assets) to public/cesium, which Cesium loads at runtime.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'cesium', 'Build', 'Cesium');
const dest = join(root, 'public', 'cesium');

if (!existsSync(src)) {
  console.error(`Cesium build not found at ${src}; run npm install first`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const dir of ['Workers', 'ThirdParty', 'Assets', 'Widgets']) cpSync(join(src, dir), join(dest, dir), { recursive: true });
console.log(`Copied Cesium runtime to ${dest}`);
