"use client";

/** Client-side photo handling: decode (EXIF orientation applied), crop to 9:16, re-encode JPEG, cheap checks. */

export const OUTPUT_W = 1080;
export const OUTPUT_H = 1920;
export const MIN_OUTPUT_SHORT_SIDE = 400;
const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 9.5 * 1024 * 1024;

export class PhotoError extends Error {}

export interface LoadedPhoto {
  bitmap: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  previewUrl: string;
}

export async function loadPhoto(file: File): Promise<LoadedPhoto> {
  if (file.size === 0) throw new PhotoError("That file is empty.");
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError("That photo is too large. Pick one under 30 MB.");
  if (file.type && !file.type.startsWith("image/"))
    throw new PhotoError("That isn't an image. Pick a photo.");
  const previewUrl = URL.createObjectURL(file);
  try {
    let bitmap: ImageBitmap | HTMLImageElement;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("decode"));
        img.src = previewUrl;
      });
    }
    const width = "naturalWidth" in bitmap ? bitmap.naturalWidth : bitmap.width;
    const height = "naturalHeight" in bitmap ? bitmap.naturalHeight : bitmap.height;
    if (!width || !height) throw new Error("empty");
    return { bitmap, width, height, previewUrl };
  } catch {
    URL.revokeObjectURL(previewUrl);
    throw new PhotoError(
      "We couldn't open that photo. Try a JPEG, PNG or WebP (some HEIC photos aren't supported by this browser).",
    );
  }
}

export interface CropState {
  /** Zoom multiplier on top of the cover scale (1 = cover). */
  zoom: number;
  /** Image top-left offset relative to frame top-left, in frame pixels. */
  x: number;
  y: number;
}

export function coverScale(frameW: number, frameH: number, imgW: number, imgH: number): number {
  return Math.max(frameW / imgW, frameH / imgH);
}

/** Keep the image covering the frame at all times. */
export function clampCrop(
  c: CropState,
  frameW: number,
  frameH: number,
  imgW: number,
  imgH: number,
): CropState {
  const zoom = Math.min(4, Math.max(1, c.zoom));
  const s = coverScale(frameW, frameH, imgW, imgH) * zoom;
  const dw = imgW * s;
  const dh = imgH * s;
  return { zoom, x: Math.min(0, Math.max(frameW - dw, c.x)), y: Math.min(0, Math.max(frameH - dh, c.y)) };
}

export function centeredCrop(frameW: number, frameH: number, imgW: number, imgH: number): CropState {
  const s = coverScale(frameW, frameH, imgW, imgH);
  return { zoom: 1, x: (frameW - imgW * s) / 2, y: (frameH - imgH * s) / 2 };
}

/** Source rectangle (in image pixels) that the frame currently shows. */
export function sourceRect(c: CropState, frameW: number, frameH: number, imgW: number, imgH: number) {
  const s = coverScale(frameW, frameH, imgW, imgH) * c.zoom;
  return { sx: -c.x / s, sy: -c.y / s, sw: frameW / s, sh: frameH / s };
}

export async function renderCrop(
  photo: LoadedPhoto,
  c: CropState,
  frameW: number,
  frameH: number,
): Promise<Blob> {
  const { sx, sy, sw, sh } = sourceRect(c, frameW, frameH, photo.width, photo.height);
  const outW = Math.round(Math.min(OUTPUT_W, sw));
  const outH = Math.round((outW * 16) / 9);
  if (outW < MIN_OUTPUT_SHORT_SIDE)
    throw new PhotoError("You've zoomed in too far for this photo's resolution. Zoom out a little.");
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoError("Your browser couldn't process the photo.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(photo.bitmap as CanvasImageSource, sx, sy, sw, sh, 0, 0, outW, outH);
  for (const q of [0.9, 0.82, 0.72]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= MAX_OUTPUT_BYTES) return blob;
  }
  throw new PhotoError("That photo is too large after cropping.");
}

export interface PhotoCheck {
  id: "resolution" | "dark" | "bright" | "contrast";
  message: string;
}

/**
 * Cheap, honest heuristics. They cannot tell whether a full body is visible —
 * the UI says so. Pose-based suitability analysis is a future pluggable step.
 */
export function quickChecks(photo: LoadedPhoto, c: CropState, frameW: number, frameH: number): PhotoCheck[] {
  const out: PhotoCheck[] = [];
  const { sx, sy, sw, sh } = sourceRect(c, frameW, frameH, photo.width, photo.height);
  if (sw < 720) out.push({ id: "resolution", message: "Low resolution — results may look soft." });
  try {
    const n = 48;
    const canvas = document.createElement("canvas");
    canvas.width = n;
    canvas.height = Math.round((n * 16) / 9);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return out;
    ctx.drawImage(photo.bitmap as CanvasImageSource, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    let sumSq = 0;
    const px = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      sum += l;
      sumSq += l * l;
    }
    const mean = sum / px;
    const sd = Math.sqrt(Math.max(0, sumSq / px - mean * mean));
    if (mean < 55) out.push({ id: "dark", message: "Looks dark — brighter light helps the video engine." });
    if (mean > 215) out.push({ id: "bright", message: "Looks overexposed — details may get lost." });
    if (sd < 22)
      out.push({ id: "contrast", message: "Low contrast — make sure you stand out from the background." });
  } catch {
    /* canvas tainted/unavailable: skip */
  }
  return out;
}
