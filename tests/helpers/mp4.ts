/** Build a structurally valid (header-only) MP4 for parser and pipeline tests. */

function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, "ascii");
  return Buffer.concat([head, body]);
}

function u32(n: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

function mvhd(timescale: number, duration: number) {
  return box(
    "mvhd",
    Buffer.from([0, 0, 0, 0]),
    u32(0),
    u32(0),
    u32(timescale),
    u32(duration),
    Buffer.alloc(80),
  );
}

function tkhd(width: number, height: number, rotate90: boolean) {
  const fixed = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 8 + 2 + 2 + 2 + 2);
  const matrix = Buffer.alloc(36);
  if (rotate90) {
    matrix.writeInt32BE(0, 0);
    matrix.writeInt32BE(0x10000, 4);
    matrix.writeInt32BE(-0x10000, 12);
    matrix.writeInt32BE(0, 16);
  } else {
    matrix.writeInt32BE(0x10000, 0);
    matrix.writeInt32BE(0x10000, 16);
  }
  matrix.writeInt32BE(0x40000000, 32);
  return box("tkhd", Buffer.from([0, 0, 0, 3]), fixed, matrix, u32(width << 16), u32(height << 16));
}

function mdhd(timescale: number, duration: number) {
  return box(
    "mdhd",
    Buffer.from([0, 0, 0, 0]),
    u32(0),
    u32(0),
    u32(timescale),
    u32(duration),
    Buffer.alloc(4),
  );
}

function hdlr(kind: "vide" | "soun") {
  return box(
    "hdlr",
    Buffer.alloc(4),
    Buffer.alloc(4),
    Buffer.from(kind, "ascii"),
    Buffer.alloc(12),
    Buffer.from("h\0"),
  );
}

function stts(samples: number, delta: number) {
  return box("stts", Buffer.alloc(4), u32(1), u32(samples), u32(delta));
}

export function makeMp4(
  opts: {
    width?: number;
    height?: number;
    seconds?: number;
    fps?: number;
    audio?: boolean;
    rotate90?: boolean;
  } = {},
): Buffer {
  const { width = 1080, height = 1920, seconds = 6, fps = 30, audio = false, rotate90 = false } = opts;
  const ts = 600;
  const vts = fps * 100;
  const video = box(
    "trak",
    tkhd(width, height, rotate90),
    box("mdia", mdhd(vts, seconds * vts), hdlr("vide"), box("minf", box("stbl", stts(seconds * fps, 100)))),
  );
  const tracks = [video];
  if (audio)
    tracks.push(box("trak", tkhd(0, 0, false), box("mdia", mdhd(48000, seconds * 48000), hdlr("soun"))));
  return Buffer.concat([
    box("ftyp", Buffer.from("isom"), u32(512), Buffer.from("isomiso2mp41")),
    box("moov", mvhd(ts, seconds * ts), ...tracks),
    box("mdat", Buffer.alloc(64)),
  ]);
}
