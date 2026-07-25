// Generate the PWA icon set from code, so the repo carries no binary blobs it
// cannot reproduce. Run with: node scripts/generate-icons.mjs
//
// The mark is a horizon: a deep-sea gradient, a brass sun line, and two swells in
// the app's accent colour. Deliberately simple — it has to read at 48px on a home
// screen. `maskable` keeps the mark inside the centre 80% safe zone.
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const DEEP = [0x16, 0x30, 0x40];
const DEEPER = [0x07, 0x12, 0x19];
const SEA = [0x3f, 0x9f, 0xb0];
const BRASS = [0xd8, 0xa6, 0x57];
const INK = [0xe8, 0xf1, 0xf5];

/** @param {number} size @param {number} inset fraction of the size kept clear */
function render(size, inset) {
  const px = new Uint8Array(size * size * 4);
  const scale = 1 - inset * 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Coordinates inside the mark's safe box, 0..1.
      const u = (x / size - inset) / scale;
      const v = (y / size - inset) / scale;

      let colour = mix(DEEP, DEEPER, clamp(y / size));

      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
        // Sun: a disc sitting on the horizon.
        const horizon = 0.58;
        const dx = u - 0.5;
        const dy = v - horizon;
        const sun = Math.hypot(dx, dy * 1.05);
        if (v < horizon && sun < 0.22) colour = mix(BRASS, INK, clamp(1 - sun / 0.22) * 0.35);

        // Two swells below it.
        for (const [base, amp, freq, thickness, tint] of [
          [horizon + 0.1, 0.045, 2.1, 0.045, SEA],
          [horizon + 0.24, 0.035, 2.8, 0.035, mix(SEA, INK, 0.25)],
        ]) {
          const wave = base + Math.sin((u + (freq === 2.1 ? 0 : 0.6)) * Math.PI * freq) * amp;
          if (Math.abs(v - wave) < thickness) colour = tint;
        }
      }

      const i = (y * size + x) * 4;
      px[i] = colour[0];
      px[i + 1] = colour[1];
      px[i + 2] = colour[2];
      px[i + 3] = 255;
    }
  }

  return encodePng(size, size, px);
}

function clamp(n) {
  return Math.min(1, Math.max(0, n));
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// ── Minimal PNG encoder (RGBA, no filtering) ────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // One filter byte (0 = none) per scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Write the set ───────────────────────────────────────────────────────────

await mkdir(outDir, { recursive: true });

const files = [
  ["icon-192.png", render(192, 0.08)],
  ["icon-512.png", render(512, 0.08)],
  // Maskable: the platform may crop to a circle, so keep the mark well inside.
  ["maskable-512.png", render(512, 0.18)],
  ["apple-touch-icon.png", render(180, 0.08)],
];

for (const [name, buffer] of files) {
  await writeFile(resolve(outDir, name), buffer);
  console.log(`wrote ${name} (${buffer.length} bytes)`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Games">
  <defs>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#163040"/>
      <stop offset="1" stop-color="#071219"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="12" fill="url(#sea)"/>
  <circle cx="32" cy="30" r="9" fill="#d8a657"/>
  <path d="M8 40q8-4 16 0t16 0 16 0" fill="none" stroke="#3f9fb0" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M8 49q8-4 16 0t16 0 16 0" fill="none" stroke="#7fc0cb" stroke-width="2.4" stroke-linecap="round"/>
</svg>
`;
await writeFile(resolve(outDir, "icon.svg"), svg);
console.log("wrote icon.svg");
