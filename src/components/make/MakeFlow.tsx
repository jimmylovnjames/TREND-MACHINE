"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { trackEvent } from "@/client/analytics";
import { api, ApiError, newIdempotencyKey, uploadPhoto } from "@/client/api";
import { flowReducer, initialFlow, type FlowError } from "@/client/flow";
import {
  loadPhoto,
  PhotoError,
  quickChecks,
  renderCrop,
  type CropState,
  type LoadedPhoto,
  type PhotoCheck,
} from "@/client/image";
import { rememberJob } from "@/client/recent";
import { ErrorPanel } from "@/components/ErrorPanel";
import { MotionSketch } from "@/components/MotionSketch";
import type { PublicTemplate } from "@/domain/template";
import { PhotoCropper } from "./PhotoCropper";

type Step = "pick" | "crop" | "confirm";

function toFlowError(e: unknown, fallbackCode = "INTERNAL_ERROR"): FlowError {
  if (e instanceof ApiError)
    return {
      code: e.code,
      title: e.title,
      message: e.message,
      actions: e.actions.length ? e.actions : ["RETRY"],
    };
  if (e instanceof PhotoError)
    return {
      code: "INVALID_INPUT",
      title: "That photo can't be used",
      message: e.message,
      actions: ["CHANGE_PHOTO"],
    };
  return {
    code: fallbackCode,
    title: "Something went wrong",
    message: "Please try again.",
    actions: ["RETRY"],
  };
}

export function MakeFlow({ template }: { template: PublicTemplate }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("pick");
  const [photo, setPhoto] = useState<LoadedPhoto | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [checks, setChecks] = useState<PhotoCheck[]>([]);
  const [rights, setRights] = useState(false);
  const [flow, dispatch] = useReducer(flowReducer, initialFlow);
  const cropRef = useRef<{ crop: CropState; frame: { w: number; h: number } } | null>(null);
  // Mirror of cropRef for rendering (preview / restoring the cropper).
  const [cropView, setCropView] = useState<{ crop: CropState; frame: { w: number; h: number } } | null>(null);
  const idemKey = useRef<string | null>(null);
  const uploaded = useRef<{ id: string; cropSig: string } | null>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const ev = { templateId: template.id, templateVersion: template.version };

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.previewUrl);
    },
    [photo],
  );

  const onFile = async (file: File | undefined, source: "gallery" | "camera") => {
    if (!file) return;
    setPhotoError(null);
    try {
      const loaded = await loadPhoto(file);
      setPhoto(loaded);
      cropRef.current = null;
      setCropView(null);
      uploaded.current = null;
      idemKey.current = null;
      setStep("crop");
      trackEvent("upload_started", { ...ev, props: { surface: "make", source } });
    } catch (e) {
      setPhotoError(e instanceof PhotoError ? e.message : "We couldn't open that photo.");
    }
  };

  const onCrop = useCallback(
    (crop: CropState, frame: { w: number; h: number }) => {
      cropRef.current = { crop, frame };
      setCropView({ crop, frame });
      if (photo) setChecks(quickChecks(photo, crop, frame.w, frame.h));
    },
    [photo],
  );

  const cropSignature = () => {
    const c = cropRef.current;
    return c ? `${c.crop.zoom.toFixed(3)}:${c.crop.x.toFixed(1)}:${c.crop.y.toFixed(1)}:${c.frame.w}` : "";
  };

  const generate = async () => {
    if (!photo || !cropRef.current || !rights) return;
    dispatch({ type: "RESET" });
    dispatch({ type: "START" });
    let blob: Blob;
    try {
      const { crop, frame } = cropRef.current;
      blob = await renderCrop(photo, crop, frame.w, frame.h);
    } catch (e) {
      dispatch({ type: "INVALID", error: toFlowError(e) });
      return;
    }
    dispatch({ type: "VALID" });
    let uploadId: string;
    const sig = cropSignature();
    try {
      if (uploaded.current && uploaded.current.cropSig === sig) {
        uploadId = uploaded.current.id;
        dispatch({ type: "UPLOAD_PROGRESS", fraction: 1 });
      } else {
        const up = await uploadPhoto(blob, (f) => dispatch({ type: "UPLOAD_PROGRESS", fraction: f }));
        uploadId = up.id;
        uploaded.current = { id: up.id, cropSig: sig };
        idemKey.current = null;
        trackEvent("upload_completed", { ...ev, props: { surface: "make" } });
      }
      dispatch({ type: "UPLOADED", uploadId });
    } catch (e) {
      dispatch({ type: "UPLOAD_FAILED", error: toFlowError(e, "UPLOAD_FAILED") });
      return;
    }
    // Same key across retries of the same request => server-side dedupe, never a double job.
    idemKey.current ??= newIdempotencyKey();
    try {
      const { job } = await api.createJob({
        templateSlug: template.slug,
        uploadId,
        idempotencyKey: idemKey.current,
        rightsConfirmed: true,
      });
      rememberJob(job.id);
      dispatch({
        type: "JOB",
        jobId: job.id,
        status: job.status,
        error: job.error ? { ...job.error, actions: job.error.actions } : null,
      });
      router.push(`/g/${job.id}`);
    } catch (e) {
      dispatch({ type: "REQUEST_FAILED", error: toFlowError(e) });
    }
  };

  const onErrorAction = (a: string) => {
    if (a === "RETRY") void generate();
    if (a === "CHANGE_PHOTO") {
      dispatch({ type: "RESET" });
      setStep("pick");
      galleryInput.current?.click();
    }
    if (a === "TRY_LATER") dispatch({ type: "RESET" });
  };

  const busy = flow.phase === "VALIDATING" || flow.phase === "UPLOADING" || flow.phase === "QUEUED";

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-5 pb-[calc(var(--safe-bottom)+20px)] pt-[calc(var(--safe-top)+12px)]">
      <header className="flex items-center gap-3">
        <Link
          href={`/d/${template.slug}`}
          aria-label="Back"
          className="pressable grid h-11 w-11 place-items-center rounded-full bg-surface text-xl"
        >
          <span aria-hidden="true">←</span>
        </Link>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{stepLabel(step)}</p>
          <p className="truncate font-display text-2xl font-black uppercase leading-none">{template.name}</p>
        </div>
      </header>
      <StepDots step={step} />

      <input
        ref={galleryInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => onFile(e.target.files?.[0], "gallery")}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => onFile(e.target.files?.[0], "camera")}
      />

      {step === "pick" && (
        <section className="mt-6 flex flex-1 flex-col animate-fade-up" aria-labelledby="pick-h">
          <h1 id="pick-h" className="font-display text-5xl font-black uppercase leading-[0.85]">
            Add a full-body photo
          </h1>
          <PhotoGuide />
          {photoError && (
            <p role="alert" className="mt-4 rounded-xl bg-danger/15 p-3 text-sm text-danger">
              {photoError}
            </p>
          )}
          <div className="mt-auto flex flex-col gap-3 pt-6">
            <button
              type="button"
              onClick={() => galleryInput.current?.click()}
              className="pressable h-14 rounded-2xl bg-acid font-display text-2xl font-black uppercase text-black"
            >
              Choose photo
            </button>
            <button
              type="button"
              onClick={() => cameraInput.current?.click()}
              className="pressable h-12 rounded-2xl border border-line font-semibold"
            >
              Take a photo
            </button>
          </div>
        </section>
      )}

      {step === "crop" && photo && (
        <section className="mt-4 flex flex-1 flex-col animate-fade-up" aria-labelledby="crop-h">
          <h1 id="crop-h" className="sr-only">
            Position your photo
          </h1>
          <p className="mb-3 text-sm text-muted">Drag and zoom so your whole body fits between the lines.</p>
          <PhotoCropper photo={photo} initial={cropView} onChange={onCrop} />
          <ul className="mt-3 space-y-1 text-sm" aria-live="polite">
            {checks.map((c) => (
              <li key={c.id} className="text-warn">
                ⚠ {c.message}
              </li>
            ))}
          </ul>
          <div className="mt-auto grid grid-cols-2 gap-3 pt-5">
            <button
              type="button"
              onClick={() => galleryInput.current?.click()}
              className="pressable h-12 rounded-2xl border border-line font-semibold"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => setStep("confirm")}
              className="pressable h-12 rounded-2xl bg-acid font-bold text-black"
            >
              Looks good
            </button>
          </div>
        </section>
      )}

      {step === "confirm" && photo && (
        <section className="mt-6 flex flex-1 flex-col animate-fade-up" aria-labelledby="confirm-h">
          <h1 id="confirm-h" className="font-display text-5xl font-black uppercase leading-[0.85]">
            Ready to dance
          </h1>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <CropPreview photo={photo} crop={cropView} />
            <div className="relative aspect-[9/16] overflow-hidden rounded-2xl">
              <MotionSketch
                motif={template.artwork.motif}
                palette={template.artwork.palette}
                label={template.name}
                className="absolute inset-0"
                showLabel={false}
              />
              <span className="absolute inset-x-0 bottom-0 bg-black/60 p-2 text-center text-xs font-bold uppercase">
                {template.name}
              </span>
            </div>
          </div>

          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface p-4">
            <input
              type="checkbox"
              checked={rights}
              onChange={(e) => setRights(e.target.checked)}
              className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--color-acid)]"
            />
            <span className="text-sm">
              <span className="font-semibold">I have permission to use this photo.</span>
              <span className="block text-muted">
                It&apos;s me, or the person in it has agreed to be turned into an AI video. The result will be
                labelled as AI-generated.
              </span>
            </span>
          </label>
          <p className="mt-3 text-xs text-muted">
            Your photo is stored privately, sent only to our video engine, and deleted automatically within 24
            hours.{" "}
            <Link href="/privacy" className="underline underline-offset-2">
              Details
            </Link>
          </p>

          {flow.phase === "FAILED" && flow.error && (
            <div className="mt-5">
              <ErrorPanel error={flow.error} onAction={onErrorAction} />
            </div>
          )}

          <div className="mt-auto flex flex-col gap-3 pt-6">
            {busy && <UploadProgress phase={flow.phase} progress={flow.uploadProgress} />}
            <button
              type="button"
              disabled={!rights || busy}
              onClick={() => void generate()}
              className="pressable h-14 rounded-2xl bg-acid font-display text-2xl font-black uppercase text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Sending…" : "Make my video"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep("crop")}
              className="pressable h-11 rounded-2xl font-semibold text-muted"
            >
              Adjust photo
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

function stepLabel(step: Step) {
  return step === "pick"
    ? "Step 1 of 3 · Photo"
    : step === "crop"
      ? "Step 2 of 3 · Position"
      : "Step 3 of 3 · Confirm";
}

function StepDots({ step }: { step: Step }) {
  const i = step === "pick" ? 0 : step === "crop" ? 1 : 2;
  return (
    <div className="mt-4 flex gap-1.5" aria-hidden="true">
      {[0, 1, 2].map((n) => (
        <span key={n} className={`h-1 flex-1 rounded-full ${n <= i ? "bg-acid" : "bg-line"}`} />
      ))}
    </div>
  );
}

function PhotoGuide() {
  const good = [
    "One person only",
    "Head to feet in the frame",
    "Arms and legs visible",
    "Good, even light",
    "Plain background helps",
  ];
  const bad = [
    "Group photos",
    "Cropped at the knees or waist",
    "Arms hidden behind the body",
    "Very dark or blurry shots",
  ];
  return (
    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-2xl bg-surface p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-acid">Works best</p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {good.map((g) => (
            <li key={g} className="flex gap-2">
              <span aria-hidden="true" className="text-acid">
                ✓
              </span>
              {g}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl bg-surface p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-hot">Avoid</p>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          {bad.map((g) => (
            <li key={g} className="flex gap-2">
              <span aria-hidden="true" className="text-hot">
                ✕
              </span>
              {g}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CropPreview({
  photo,
  crop,
}: {
  photo: LoadedPhoto;
  crop: { crop: CropState; frame: { w: number; h: number } } | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !crop) return;
    const { crop: c, frame } = crop;
    const s = Math.max(frame.w / photo.width, frame.h / photo.height) * c.zoom;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = 270;
    canvas.height = 480;
    ctx.drawImage(
      photo.bitmap as CanvasImageSource,
      -c.x / s,
      -c.y / s,
      frame.w / s,
      frame.h / s,
      0,
      0,
      270,
      480,
    );
  }, [photo, crop]);
  return (
    <canvas
      ref={ref}
      className="aspect-[9/16] w-full rounded-2xl bg-surface"
      aria-label="Your cropped photo"
      role="img"
    />
  );
}

function UploadProgress({ phase, progress }: { phase: string; progress: number }) {
  const label =
    phase === "VALIDATING"
      ? "Preparing photo…"
      : phase === "UPLOADING"
        ? `Uploading ${Math.round(progress * 100)}%`
        : "Queuing your video…";
  return (
    <div aria-live="polite">
      <div className="mb-1 flex justify-between text-xs text-muted">
        <span>{label}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full bg-acid transition-[width] duration-300"
          style={{ width: `${Math.max(4, progress * 100)}%` }}
        />
      </div>
    </div>
  );
}
