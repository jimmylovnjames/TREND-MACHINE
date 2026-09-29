import { z } from "zod";
import { MOVEMENT_CHARACTERISTICS, movementPhaseSchema } from "./template";

/* ------------------------------------------------------------------ */
/* Original Dance Lab                                                  */
/* ------------------------------------------------------------------ */

export const CONCEPT_STATUSES = [
  "IDEA",
  "DESIGNED",
  "REFERENCE_PENDING",
  "REFERENCE_READY",
  "TESTING",
  "LIVE",
  "RETIRED",
] as const;
export type ConceptStatus = (typeof CONCEPT_STATUSES)[number];

const CONCEPT_FLOW: Record<ConceptStatus, readonly ConceptStatus[]> = {
  IDEA: ["DESIGNED", "RETIRED"],
  DESIGNED: ["REFERENCE_PENDING", "IDEA", "RETIRED"],
  REFERENCE_PENDING: ["REFERENCE_READY", "DESIGNED", "RETIRED"],
  REFERENCE_READY: ["TESTING", "REFERENCE_PENDING", "RETIRED"],
  TESTING: ["LIVE", "REFERENCE_READY", "RETIRED"],
  LIVE: ["RETIRED", "TESTING"],
  RETIRED: ["IDEA"],
};

export function canMoveConcept(from: ConceptStatus, to: ConceptStatus): boolean {
  return CONCEPT_FLOW[from].includes(to);
}

export const danceConceptSchema = z.object({
  id: z.string().regex(/^con_[a-z0-9_]+$/),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(60),
  status: z.enum(CONCEPT_STATUSES),
  concept: z.string().min(1).max(1200),
  hook: z.string().min(1).max(300),
  firstSecond: z.string().min(1).max(400),
  sequence: z.array(movementPhaseSchema).min(1).max(24),
  signature: z.string().min(1).max(400),
  loopPoint: z.string().min(1).max(300),
  durationSeconds: z.number().min(2).max(30),
  energy: z.number().int().min(1).max(5),
  difficulty: z.number().int().min(1).max(5),
  cameraGuidance: z.string().min(1).max(600),
  motionTransferConsiderations: z.array(z.string().min(1).max(300)).min(1),
  generationGuidance: z.string().min(1).max(1000),
  referenceCapture: z.object({
    performerBrief: z.string().min(1).max(1000),
    wardrobe: z.string().min(1).max(300),
    framing: z.string().min(1).max(300),
    tempoBpm: z.number().int().min(40).max(220).nullable(),
  }),
  provenance: z.object({
    createdBy: z.string().min(1),
    createdOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    method: z.enum(["IN_HOUSE_ORIGINAL", "COUNTERTREND_DERIVED", "COMMISSIONED"]),
    notes: z.string().max(1000),
  }),
  templateId: z.string().nullable(),
});
export type DanceConcept = z.infer<typeof danceConceptSchema>;

/* ------------------------------------------------------------------ */
/* Trend Lab                                                            */
/* ------------------------------------------------------------------ */

export const TREND_STATUSES = ["CANDIDATE", "REVIEWING", "APPROVED", "REJECTED", "TEMPLATE_CREATED"] as const;
export type TrendStatus = (typeof TREND_STATUSES)[number];

const TREND_FLOW: Record<TrendStatus, readonly TrendStatus[]> = {
  CANDIDATE: ["REVIEWING", "REJECTED"],
  REVIEWING: ["APPROVED", "REJECTED", "CANDIDATE"],
  APPROVED: ["TEMPLATE_CREATED", "REJECTED", "REVIEWING"],
  REJECTED: ["REVIEWING"],
  TEMPLATE_CREATED: [],
};

export function canMoveTrend(from: TrendStatus, to: TrendStatus): boolean {
  return TREND_FLOW[from].includes(to);
}

export const SOURCE_PLATFORMS = ["tiktok", "instagram", "youtube", "x", "snapchat", "other"] as const;

const score = z.number().int().min(1).max(5).nullable();

/**
 * Payload accepted from the external trend scanner. Only observed facts —
 * the scanner may attach raw metrics it actually captured, with a timestamp.
 * Nothing here is computed or inferred by TREND MACHINE.
 */
export const trendIngestSchema = z
  .object({
    externalRef: z.string().min(1).max(200),
    name: z.string().min(1).max(120),
    sourcePlatform: z.enum(SOURCE_PLATFORMS),
    sourceUrl: z.string().url().max(2000),
    observedAt: z.string().datetime(),
    movementDescription: z.string().max(2000).default(""),
    signatureMovement: z.string().max(600).default(""),
    hook: z.string().max(600).default(""),
    evidence: z
      .array(
        z.object({
          url: z.string().url().max(2000),
          platform: z.enum(SOURCE_PLATFORMS),
          observedAt: z.string().datetime(),
          note: z.string().max(1000).default(""),
          observedMetrics: z.record(z.string(), z.number()).optional(),
        }),
      )
      .max(50)
      .default([]),
  })
  .strict();
export type TrendIngest = z.infer<typeof trendIngestSchema>;

export const trendReviewSchema = z
  .object({
    status: z.enum(TREND_STATUSES).optional(),
    loopability: score.optional(),
    motionTransferSuitability: score.optional(),
    singlePhotoSuitability: score.optional(),
    reproductionDifficulty: score.optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict();

/** A human- or model-authored assessment of *why* a movement works. */
export const mechanicAssessmentSchema = z
  .object({
    characteristic: z.enum(MOVEMENT_CHARACTERISTICS),
    score: z.number().int().min(0).max(5).nullable(),
    rationale: z.string().min(1).max(2000),
    assessedBy: z.enum(["HUMAN", "MODEL"]),
    assessor: z.string().min(1).max(120),
  })
  .strict();

export const countertrendSchema = z
  .object({
    trendId: z.string().uuid(),
    conceptId: z.string().regex(/^con_[a-z0-9_]+$/),
    mechanicsExploited: z.array(z.enum(MOVEMENT_CHARACTERISTICS)).min(1),
    differentiation: z.string().min(1).max(2000),
  })
  .strict();
