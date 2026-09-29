import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/**
 * Encode an RGB PNG. `pixel(x, y)` returns [r, g, b]. Optional extra chunks
 * (e.g. tEXt / eXIf) are inserted before IDAT for metadata-stripping tests.
 */
export function makePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number] = () => [128, 128, 128],
  extra: { type: string; data: Buffer }[] = [],
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra.map((e) => chunk(e.type, e.data)),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A simple standing-figure silhouette on a light background (portrait). */
export function figurePng(width = 720, height = 1280): Buffer {
  const cx = width / 2;
  return makePng(width, height, (x, y) => {
    const u = y / height;
    const dx = Math.abs(x - cx) / width;
    const head = Math.hypot((x - cx) / width, u - 0.14) < 0.06;
    const torso = u > 0.2 && u < 0.55 && dx < 0.09;
    const legs = u >= 0.55 && u < 0.93 && dx > 0.02 && dx < 0.08;
    const arms = u > 0.22 && u < 0.5 && dx > 0.1 && dx < 0.14;
    return head || torso || legs || arms ? [30, 30, 40] : [220, 214, 200];
  });
}
