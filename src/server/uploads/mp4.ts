/**
 * Minimal ISO-BMFF (MP4) inspector for reference-motion assets: duration, display
 * dimensions (rotation-aware), frame rate and audio presence. Reads box headers only.
 */

export interface Mp4Info {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number | null;
  hasAudio: boolean;
}

export class Mp4ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Mp4ParseError";
  }
}

interface Box {
  type: string;
  start: number; // payload start
  end: number;
}

function readU32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}
function readU64(b: Uint8Array, o: number): number {
  return readU32(b, o) * 2 ** 32 + readU32(b, o + 4);
}
function readI32(b: Uint8Array, o: number): number {
  return (b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!;
}
function type(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
}

function children(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let o = start;
  while (o + 8 <= end) {
    let size = readU32(b, o);
    const t = type(b, o + 4);
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) throw new Mp4ParseError("truncated largesize box");
      size = readU64(b, o + 8);
      header = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < header || o + size > end) throw new Mp4ParseError(`bad box size for ${t}`);
    out.push({ type: t, start: o + header, end: o + size });
    o += size;
    if (out.length > 10_000) throw new Mp4ParseError("too many boxes");
  }
  return out;
}

const find = (boxes: Box[], t: string) => boxes.find((x) => x.type === t);

export function inspectMp4(b: Uint8Array): Mp4Info {
  const top = children(b, 0, b.length);
  if (!find(top, "ftyp")) throw new Mp4ParseError("not an MP4 (missing ftyp)");
  const moov = find(top, "moov");
  if (!moov) throw new Mp4ParseError("missing moov box");
  const moovKids = children(b, moov.start, moov.end);
  const mvhd = find(moovKids, "mvhd");
  if (!mvhd) throw new Mp4ParseError("missing mvhd");
  const v = b[mvhd.start]!;
  const timescale = readU32(b, mvhd.start + (v === 1 ? 20 : 12));
  const duration = v === 1 ? readU64(b, mvhd.start + 24) : readU32(b, mvhd.start + 16);
  if (!timescale) throw new Mp4ParseError("zero timescale");

  let width = 0;
  let height = 0;
  let fps: number | null = null;
  let hasAudio = false;
  for (const trak of moovKids.filter((x) => x.type === "trak")) {
    const tk = children(b, trak.start, trak.end);
    const mdia = find(tk, "mdia");
    if (!mdia) continue;
    const md = children(b, mdia.start, mdia.end);
    const hdlr = find(md, "hdlr");
    const handler = hdlr ? type(b, hdlr.start + 8) : "";
    if (handler === "soun") hasAudio = true;
    if (handler !== "vide" || width) continue;
    const tkhd = find(tk, "tkhd");
    if (tkhd) {
      const tv = b[tkhd.start]!;
      const base = tkhd.start + (tv === 1 ? 12 : 0);
      const a = readI32(b, base + 40);
      const bb = readI32(b, base + 44);
      width = readU32(b, base + 76) >>> 16;
      height = readU32(b, base + 80) >>> 16;
      const rotated = a === 0 && Math.abs(bb) === 0x10000;
      if (rotated) [width, height] = [height, width];
    }
    const mdhd = find(md, "mdhd");
    const minf = find(md, "minf");
    if (mdhd && minf) {
      const mv = b[mdhd.start]!;
      const ts = readU32(b, mdhd.start + (mv === 1 ? 20 : 12));
      const dur = mv === 1 ? readU64(b, mdhd.start + 24) : readU32(b, mdhd.start + 16);
      const stbl = find(children(b, minf.start, minf.end), "stbl");
      const stts = stbl ? find(children(b, stbl.start, stbl.end), "stts") : undefined;
      if (stts && ts && dur) {
        const n = readU32(b, stts.start + 4);
        let samples = 0;
        for (let i = 0; i < n && stts.start + 8 + i * 8 + 8 <= stts.end; i++)
          samples += readU32(b, stts.start + 8 + i * 8);
        fps = Math.round((samples / (dur / ts)) * 1000) / 1000;
      }
    }
  }
  if (!width || !height) throw new Mp4ParseError("no video track");
  return { durationSeconds: Math.round((duration / timescale) * 1000) / 1000, width, height, fps, hasAudio };
}
