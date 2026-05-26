// Copies ffmpeg-core.js and ffmpeg-core.wasm from node_modules into public/ffmpeg/
// so Vite can serve them as static assets without CDN dependency.
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, '../node_modules/@ffmpeg/core/dist/umd');
const dest = resolve(__dirname, '../public/ffmpeg');

mkdirSync(dest, { recursive: true });
copyFileSync(`${src}/ffmpeg-core.js`, `${dest}/ffmpeg-core.js`);
copyFileSync(`${src}/ffmpeg-core.wasm`, `${dest}/ffmpeg-core.wasm`);
console.log('ffmpeg-core assets synced to public/ffmpeg/');
