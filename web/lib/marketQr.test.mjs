// The mandated ACTUAL DECODE test: generate the QR exactly as the export path does, then decode
// it with an independent decoder and assert the round trip. A QR that renders but does not scan
// is a printed lie, so this uses jsqr — a different implementation — not qrcode reading itself.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));

const QRCode = require('qrcode');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');

const results = [];
const ck = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`);
};

const code = 'deadbeef01234567';
const target = `https://gnomefarmersmarket.com/q/${code}`;

// Same options as web/lib/marketQr.ts nakedQrPng.
const buf = await QRCode.toBuffer(target, { errorCorrectionLevel: 'M', margin: 2, width: 1024 });
const png = PNG.sync.read(buf);
ck('PNG is print-scale, not a screenshot', png.width >= 1024, `${png.width}px`);

const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
ck('an independent decoder reads the QR at all', !!decoded);
ck('decoded URL is exactly the durable /q/ redirect', decoded?.data === target, decoded?.data);
ck('the URL carries only the opaque code — no query, no token',
  !/[?#&=]/.test(decoded?.data ?? '?'), decoded?.data);

const svg = await QRCode.toString(target, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 1024 });
ck('SVG export produces a real vector', svg.includes('<svg') && svg.includes('path'));

const failed = results.filter((r) => !r).length;
console.log(`\nmarket qr decode: ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
