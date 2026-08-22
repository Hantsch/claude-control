/**
 * Minimal PNG decoder for the shipped tray tiles (§014 D3) — 8-bit RGBA truecolor+alpha,
 * non-interlaced only, which is exactly the format `scripts/build-icons.py` emits. Anything
 * else throws loudly rather than silently producing garbage pixels: no palette, no greyscale,
 * no 16-bit, no interlacing.
 *
 * Only `node:zlib` is used for the DEFLATE stream — no new dependency for a handful of tiny
 * fixed-format files.
 */

import { inflateSync } from 'node:zlib';

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  pixels: Buffer;
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buffer: Buffer): DecodedPng {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('not a PNG file (bad signature)');
  }

  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  let offset = 8;

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data.readUInt8(8);
      const colorType = data.readUInt8(9);
      const interlace = data.readUInt8(12);
      if (bitDepth !== 8) {
        throw new Error(`not decodable by this reader: bit depth ${bitDepth} (need 8)`);
      }
      if (colorType !== 6) {
        throw new Error(`not decodable by this reader: colour type ${colorType} (need 6, RGBA)`);
      }
      if (interlace !== 0) {
        throw new Error(`not decodable by this reader: interlaced PNG (need none)`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset += 8 + length + 4; // length + type + data + CRC
  }

  if (width === 0 || height === 0) {
    throw new Error('not decodable by this reader: missing or empty IHDR');
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * stride;
    const prevRowStart = (y - 1) * stride;

    for (let x = 0; x < stride; x += 1) {
      const value = raw[rawOffset + x] ?? 0;
      const a = x >= bytesPerPixel ? (pixels[rowStart + x - bytesPerPixel] ?? 0) : 0;
      const b = y > 0 ? (pixels[prevRowStart + x] ?? 0) : 0;
      const c = y > 0 && x >= bytesPerPixel ? (pixels[prevRowStart + x - bytesPerPixel] ?? 0) : 0;

      let reconstructed: number;
      switch (filterType) {
        case 0: // None
          reconstructed = value;
          break;
        case 1: // Sub
          reconstructed = value + a;
          break;
        case 2: // Up
          reconstructed = value + b;
          break;
        case 3: // Average
          reconstructed = value + Math.floor((a + b) / 2);
          break;
        case 4: // Paeth
          reconstructed = value + paeth(a, b, c);
          break;
        default:
          throw new Error(`not decodable by this reader: unknown filter type ${filterType}`);
      }
      pixels[rowStart + x] = reconstructed & 0xff;
    }
    rawOffset += stride;
  }

  return { width, height, pixels };
}

export function pixelAt(
  png: DecodedPng,
  x: number,
  y: number,
): { r: number; g: number; b: number; a: number } {
  const i = (y * png.width + x) * 4;
  return {
    r: png.pixels[i] ?? 0,
    g: png.pixels[i + 1] ?? 0,
    b: png.pixels[i + 2] ?? 0,
    a: png.pixels[i + 3] ?? 0,
  };
}
