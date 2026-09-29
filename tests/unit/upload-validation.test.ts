import { describe, expect, it } from "vitest";
import { ImageValidationError, processImage, sniffImageType } from "@/server/uploads/image";
import { makePng } from "../helpers/png";

const MAX = 10 * 1024 * 1024;

function reason(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof ImageValidationError) return e.reason;
    throw e;
  }
  return undefined;
}

/** Minimal JPEG structure: SOI, APP0, APP1(EXIF w/ fake GPS), COM, SOF0, SOS, data, EOI. */
function makeJpeg(width: number, height: number): Buffer {
  const seg = (marker: number, payload: Buffer) => {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(payload.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
  };
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("JFIF\0\x01\x02\0\0\x01\0\x01\0\0", "binary")),
    seg(0xe1, Buffer.from("Exif\0\0GPS-LAT-51.5N-LON-0.12W", "binary")),
    seg(0xfe, Buffer.from("secret comment")),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0x56, 0xff, 0x00, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

describe("upload validation", () => {
  it("sniffs type from magic bytes, not the declared MIME", () => {
    expect(sniffImageType(makePng(1, 1))).toBe("image/png");
    expect(sniffImageType(makeJpeg(10, 10))).toBe("image/jpeg");
    expect(sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(sniffImageType(Buffer.from("GIF89a..."))).toBeNull();
  });

  it("accepts a valid portrait PNG and strips text/EXIF chunks", () => {
    const png = makePng(540, 960, () => [10, 20, 30], [
      { type: "tEXt", data: Buffer.from("Author\0Somebody") },
      { type: "eXIf", data: Buffer.from("GPSDATA") },
    ]);
    const out = processImage(png, MAX);
    expect(out).toMatchObject({ contentType: "image/png", width: 540, height: 960 });
    const s = Buffer.from(out.data).toString("latin1");
    expect(s).not.toContain("tEXt");
    expect(s).not.toContain("GPSDATA");
    expect(out.strippedBytes).toBeGreaterThan(0);
  });

  it("reads JPEG dimensions and strips EXIF/comments while keeping JFIF + scan data", () => {
    const out = processImage(makeJpeg(1080, 1920), MAX);
    expect(out).toMatchObject({ contentType: "image/jpeg", width: 1080, height: 1920 });
    const s = Buffer.from(out.data).toString("latin1");
    expect(s).not.toContain("GPS-LAT");
    expect(s).not.toContain("secret comment");
    expect(s).toContain("JFIF");
    expect(out.data.at(-1)).toBe(0xd9);
  });

  it("rejects spoofed, empty, oversized, tiny, extreme-aspect, corrupt and animated files", () => {
    expect(reason(() => processImage(Buffer.from("not an image at all, just text pretending"), MAX))).toBe(
      "UNSUPPORTED_TYPE",
    );
    expect(reason(() => processImage(Buffer.alloc(0), MAX))).toBe("EMPTY");
    expect(reason(() => processImage(makePng(500, 900), 100))).toBe("TOO_LARGE");
    expect(reason(() => processImage(makePng(200, 300), MAX))).toBe("TOO_SMALL");
    expect(reason(() => processImage(makePng(420, 1400), MAX))).toBe("BAD_ASPECT");
    const png = makePng(500, 900);
    expect(reason(() => processImage(png.subarray(0, png.length - 20), MAX))).toBe("CORRUPT");
    expect(reason(() => processImage(makeJpeg(1080, 1920).subarray(0, 30), MAX))).toBe("CORRUPT");
    const apng = makePng(500, 900, undefined, [{ type: "acTL", data: Buffer.alloc(8) }]);
    expect(reason(() => processImage(apng, MAX))).toBe("ANIMATED");
  });

  it("rejects decompression-bomb dimensions without decoding", () => {
    expect(reason(() => processImage(makeJpeg(9000, 16000), MAX))).toBe("TOO_BIG");
  });

  it("handles WebP (VP8X) and strips EXIF chunk + flag", () => {
    const chunk = (fourcc: string, data: Buffer) => {
      const h = Buffer.alloc(8);
      h.write(fourcc, 0, "ascii");
      h.writeUInt32LE(data.length, 4);
      return Buffer.concat([h, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    };
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x08; // EXIF flag
    vp8x.writeUIntLE(720 - 1, 4, 3);
    vp8x.writeUIntLE(1280 - 1, 7, 3);
    const vp8 = Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a, 0xd0, 0x02, 0x00, 0x05, 0, 0]);
    const body = Buffer.concat([
      Buffer.from("WEBP"),
      chunk("VP8X", vp8x),
      chunk("VP8 ", vp8),
      chunk("EXIF", Buffer.from("GPS-SECRET")),
    ]);
    const riff = Buffer.alloc(8);
    riff.write("RIFF", 0, "ascii");
    riff.writeUInt32LE(body.length, 4);
    const out = processImage(Buffer.concat([riff, body]), MAX);
    expect(out).toMatchObject({ contentType: "image/webp", width: 720, height: 1280 });
    const s = Buffer.from(out.data).toString("latin1");
    expect(s).not.toContain("GPS-SECRET");
    expect(out.data[20]! & 0x08).toBe(0);
    expect(Buffer.from(out.data).readUInt32LE(4)).toBe(out.data.length - 8);
  });
});
