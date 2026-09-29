/**
 * Server-side image validation without decoding pixels.
 *
 * - Content type is determined from magic bytes; the client-declared MIME type is
 *   never trusted (MIME spoofing defence).
 * - Dimensions are read from container headers.
 * - Privacy-sensitive metadata (EXIF incl. GPS, XMP, text chunks, comments) is stripped.
 */

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export const IMAGE_LIMITS = {
  minShortSide: 400,
  maxLongSide: 8192,
  maxPixels: 40_000_000,
  /** Width/height range accepted by current motion-transfer providers. */
  minAspect: 0.4,
  maxAspect: 2.5,
} as const;

export type ImageRejectReason =
  | "EMPTY"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "CORRUPT"
  | "ANIMATED"
  | "TOO_SMALL"
  | "TOO_BIG"
  | "BAD_ASPECT";

export class ImageValidationError extends Error {
  constructor(
    readonly reason: ImageRejectReason,
    message: string,
  ) {
    super(message);
    this.name = "ImageValidationError";
  }
}

const REASON_MESSAGES: Record<ImageRejectReason, string> = {
  EMPTY: "The file is empty.",
  TOO_LARGE: "That photo is too large. Use one under 10 MB.",
  UNSUPPORTED_TYPE: "Use a JPEG, PNG or WebP photo.",
  CORRUPT: "That file doesn't look like a readable image.",
  ANIMATED: "Animated images aren't supported. Use a still photo.",
  TOO_SMALL: `That photo is too small. Use one at least ${IMAGE_LIMITS.minShortSide}px on its shortest side.`,
  TOO_BIG: "That photo's dimensions are too large.",
  BAD_ASPECT: "That photo is too wide or too tall. Crop it closer to portrait.",
};

export function imageRejectMessage(reason: ImageRejectReason): string {
  return REASON_MESSAGES[reason];
}

function reject(reason: ImageRejectReason): never {
  throw new ImageValidationError(reason, REASON_MESSAGES[reason]);
}

export function sniffImageType(b: Uint8Array): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return "image/png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  return null;
}

function ascii(b: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = off; i < off + len && i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

const u16be = (b: Uint8Array, o: number) => ((b[o]! << 8) | b[o + 1]!) >>> 0;
const u32be = (b: Uint8Array, o: number) =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u32le = (b: Uint8Array, o: number) =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);

export interface ProcessedImage {
  contentType: ImageType;
  width: number;
  height: number;
  data: Uint8Array;
  strippedBytes: number;
}

/** Validate an uploaded image and return a metadata-stripped copy. Throws ImageValidationError. */
export function processImage(input: Uint8Array, maxBytes: number): ProcessedImage {
  if (input.byteLength === 0) reject("EMPTY");
  if (input.byteLength > maxBytes) reject("TOO_LARGE");
  const type = sniffImageType(input);
  if (!type) reject("UNSUPPORTED_TYPE");
  let result: { width: number; height: number; data: Uint8Array };
  try {
    result =
      type === "image/jpeg"
        ? processJpeg(input)
        : type === "image/png"
          ? processPng(input)
          : processWebp(input);
  } catch (e) {
    if (e instanceof ImageValidationError) throw e;
    reject("CORRUPT");
  }
  const { width, height } = result;
  if (!width || !height) reject("CORRUPT");
  if (Math.min(width, height) < IMAGE_LIMITS.minShortSide) reject("TOO_SMALL");
  if (Math.max(width, height) > IMAGE_LIMITS.maxLongSide || width * height > IMAGE_LIMITS.maxPixels)
    reject("TOO_BIG");
  const aspect = width / height;
  if (aspect < IMAGE_LIMITS.minAspect || aspect > IMAGE_LIMITS.maxAspect) reject("BAD_ASPECT");
  return {
    contentType: type,
    width,
    height,
    data: result.data,
    strippedBytes: input.byteLength - result.data.byteLength,
  };
}

/* ------------------------------- JPEG ---------------------------------- */

// Keep APP0 (JFIF), APP2 (ICC colour profile) and APP14 (Adobe colour transform).
const JPEG_KEEP_APP = new Set([0xe0, 0xe2, 0xee]);

function processJpeg(b: Uint8Array) {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let o = 2;
  let width = 0;
  let height = 0;
  for (;;) {
    if (o + 4 > b.length) reject("CORRUPT");
    if (b[o] !== 0xff) reject("CORRUPT");
    const marker = b[o + 1]!;
    if (marker === 0xff) {
      o++; // fill byte
      continue;
    }
    if (marker === 0xd9) reject("CORRUPT"); // EOI before SOS
    const len = u16be(b, o + 2);
    if (len < 2 || o + 2 + len > b.length) reject("CORRUPT");
    const seg = b.subarray(o, o + 2 + len);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      height = u16be(b, o + 5);
      width = u16be(b, o + 7);
    }
    if (marker === 0xda) {
      // Start of scan: everything from here is image data through EOI.
      if (!width || !height) reject("CORRUPT");
      out.push(b.subarray(o));
      break;
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isComment = marker === 0xfe;
    if (!(isApp && !JPEG_KEEP_APP.has(marker)) && !isComment) out.push(seg);
    o += 2 + len;
  }
  return { width, height, data: concat(out) };
}

/* -------------------------------- PNG ---------------------------------- */

const PNG_DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function processPng(b: Uint8Array) {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let o = 8;
  let width = 0;
  let height = 0;
  let sawIend = false;
  while (o + 12 <= b.length) {
    const len = u32be(b, o);
    const type = ascii(b, o + 4, 4);
    const end = o + 12 + len;
    if (end > b.length) reject("CORRUPT");
    if (type === "IHDR") {
      width = u32be(b, o + 8);
      height = u32be(b, o + 12);
    }
    if (type === "acTL") reject("ANIMATED");
    if (!PNG_DROP.has(type)) out.push(b.subarray(o, end));
    o = end;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!sawIend || !width) reject("CORRUPT");
  return { width, height, data: concat(out) };
}

/* -------------------------------- WebP --------------------------------- */

function processWebp(b: Uint8Array) {
  const riffSize = u32le(b, 4);
  if (riffSize + 8 > b.length || riffSize < 12) reject("CORRUPT");
  const chunks: Uint8Array[] = [];
  let o = 12;
  let width = 0;
  let height = 0;
  let vp8xIndex = -1;
  while (o + 8 <= 8 + riffSize) {
    const fourcc = ascii(b, o, 4);
    const size = u32le(b, o + 4);
    const padded = size + (size & 1);
    const end = o + 8 + padded;
    if (o + 8 + size > b.length) reject("CORRUPT");
    const data = o + 8;
    if (fourcc === "VP8X") {
      const flags = b[data]!;
      if (flags & 0x02) reject("ANIMATED");
      width = u24le(b, data + 4) + 1;
      height = u24le(b, data + 7) + 1;
      vp8xIndex = chunks.length;
    } else if (fourcc === "VP8 " && !width) {
      if (b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a) reject("CORRUPT");
      width = (b[data + 6]! | (b[data + 7]! << 8)) & 0x3fff;
      height = (b[data + 8]! | (b[data + 9]! << 8)) & 0x3fff;
    } else if (fourcc === "VP8L" && !width) {
      if (b[data] !== 0x2f) reject("CORRUPT");
      const bits = u32le(b, data + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (fourcc === "ANIM" || fourcc === "ANMF") {
      reject("ANIMATED");
    }
    if (fourcc !== "EXIF" && fourcc !== "XMP ") chunks.push(b.subarray(o, Math.min(end, b.length)));
    o = end;
  }
  if (!width) reject("CORRUPT");
  if (vp8xIndex >= 0) {
    // Clear EXIF (0x08) and XMP (0x04) flags now that those chunks are gone.
    const c = new Uint8Array(chunks[vp8xIndex]!);
    c[8] = c[8]! & ~0x0c;
    chunks[vp8xIndex] = c;
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 12));
  const size = body.byteLength + 4;
  header[4] = size & 0xff;
  header[5] = (size >>> 8) & 0xff;
  header[6] = (size >>> 16) & 0xff;
  header[7] = (size >>> 24) & 0xff;
  return { width, height, data: concat([header, body]) };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}
