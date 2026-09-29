import { z } from "zod";

/**
 * Dance template specification.
 *
 * A template is pure data: everything needed to render its card/detail UI and to
 * reproduce a generation. The repository `content/templates/*.json` files are the
 * editable source; the database stores immutable, numbered snapshots
 * (`template_versions`) and every generation job pins the exact version it used.
 */

export const TEMPLATE_STATUSES = ["DRAFT", "PREVIEW", "LIVE", "RETIRED"] as const;
export const TEMPLATE_CATEGORIES = ["ORIGINAL", "TREND", "COUNTERTREND"] as const;
export const CAPABILITIES = [
  "HUMAN_MOTION_TRANSFER",
  "MULTI_PERSON_MOTION",
  "PET_ANIMATION",
  "CHARACTER_ANIMATION",
  "STYLIZATION",
  "CINEMATIC_TRANSFORM",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const REFERENCE_MOTION_STATUSES = [
  "REFERENCE_MOTION_PENDING",
  "UPLOADED",
  "READY",
  "REJECTED",
  "RETIRED",
] as const;
export type ReferenceMotionStatus = (typeof REFERENCE_MOTION_STATUSES)[number];

/** Movement characteristics used for analysis and the future learning loop. */
export const MOVEMENT_CHARACTERISTICS = [
  "first_second_hook",
  "silhouette",
  "amplitude",
  "absurdity",
  "difficulty",
  "repetition",
  "loop_quality",
  "camera_interaction",
  "transformation_potential",
  "recognizability",
  "group_compatibility",
] as const;
export type MovementCharacteristic = (typeof MOVEMENT_CHARACTERISTICS)[number];

const level = z.number().int().min(1).max(5);
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case")
  .max(64);

export const movementPhaseSchema = z.object({
  /** Offset from the start of the loop, seconds. */
  at: z.number().min(0),
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(400),
});

export const movementSpecSchema = z.object({
  firstSecond: z.string().min(1).max(400),
  signature: z.string().min(1).max(400),
  sequence: z.array(movementPhaseSchema).min(1).max(24),
  loopPoint: z.string().min(1).max(300),
  bodyFocus: z.enum(["FULL_BODY", "LOWER_BODY", "UPPER_BODY"]),
  /**
   * Designed (intended) characteristic strengths, 0–5. These are design intent
   * from the choreographer — NOT measured audience response.
   */
  designedCharacteristics: z.partialRecord(z.enum(MOVEMENT_CHARACTERISTICS), z.number().int().min(0).max(5)),
  cameraGuidance: z.string().min(1).max(400),
  transferConsiderations: z.array(z.string().min(1).max(300)).min(1).max(12),
});

export const providerPreferenceSchema = z.object({
  providerId: z.string().min(1).max(40),
  model: z.string().min(1).max(120),
  /** Lower number = preferred. */
  priority: z.number().int().min(0).max(100),
});

export const generationRecipeSchema = z.object({
  capability: z.enum(CAPABILITIES),
  /** Scene/context prompt. Motion comes from the reference video, not text. */
  prompt: z.string().max(2000),
  characterOrientation: z.enum(["video", "image"]),
  /**
   * Audio is separable from movement. We never keep audio from reference
   * footage unless its rights are explicitly cleared.
   */
  audio: z.object({
    mode: z.enum(["NONE", "LICENSED_TRACK"]),
    trackId: z.string().max(80).nullable().default(null),
  }),
  keepReferenceAudio: z.literal(false),
  outputAspectRatio: z.enum(["9:16"]),
  /** Upper bound for provider processing before we declare TIMEOUT. */
  timeoutSeconds: z.number().int().min(60).max(3600),
});

export const templateArtworkSchema = z.object({
  motif: z.enum(["glitch", "float", "rubber"]),
  /** Hex colors used by the motion-sketch poster. */
  palette: z.tuple([
    z.string().regex(/^#[0-9a-fA-F]{6}$/),
    z.string().regex(/^#[0-9a-fA-F]{6}$/),
    z.string().regex(/^#[0-9a-fA-F]{6}$/),
  ]),
});

export const templateSpecSchema = z
  .object({
    id: z.string().regex(/^tpl_[a-z0-9_]+$/),
    slug,
    name: z.string().min(1).max(40),
    status: z.enum(TEMPLATE_STATUSES),
    category: z.enum(TEMPLATE_CATEGORIES),
    origin: z.object({
      type: z.enum(["ORIGINAL", "TREND_ADAPTATION", "COUNTERTREND"]),
      conceptId: z.string().max(80).nullable(),
      trendCandidateId: z.string().uuid().nullable(),
    }),
    tagline: z.string().min(1).max(60),
    hook: z.string().min(1).max(140),
    description: z.string().min(1).max(600),
    durationSeconds: z.number().min(2).max(30),
    aspectRatio: z.enum(["9:16"]),
    energy: level,
    difficulty: level,
    tags: z.array(z.string().min(1).max(24)).max(12),
    featured: z.boolean(),
    sortOrder: z.number().int().min(0).max(10000),
    artwork: templateArtworkSchema,
    /** Storage keys of real preview media, when it exists. Null = show motion sketch. */
    media: z.object({
      thumbnailKey: z.string().max(300).nullable(),
      previewVideoKey: z.string().max(300).nullable(),
    }),
    movement: movementSpecSchema,
    recipe: generationRecipeSchema,
    providerPreferences: z.array(providerPreferenceSchema).min(1).max(8),
    fallbackProviderId: z.string().max(40).nullable(),
    /** Provider-specific knobs, only where unavoidable. Keyed by provider id. */
    providerConfig: z.record(
      z.string(),
      z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    ),
    provenance: z.object({
      createdBy: z.string().min(1).max(120),
      method: z.enum(["IN_HOUSE_ORIGINAL", "COMMISSIONED", "TREND_ADAPTATION"]),
      createdOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().max(1000),
    }),
    rights: z.object({
      choreographyOwner: z.string().min(1).max(120),
      choreographyLicense: z.string().min(1).max(200),
      musicIncluded: z.boolean(),
      notes: z.string().max(1000),
    }),
  })
  .superRefine((t, ctx) => {
    if (t.fallbackProviderId && !t.providerPreferences.some((p) => p.providerId === t.fallbackProviderId)) {
      ctx.addIssue({
        code: "custom",
        path: ["fallbackProviderId"],
        message: "fallbackProviderId must also appear in providerPreferences",
      });
    }
    if (t.rights.musicIncluded && t.recipe.audio.mode !== "LICENSED_TRACK") {
      ctx.addIssue({
        code: "custom",
        path: ["rights", "musicIncluded"],
        message: "musicIncluded requires a LICENSED_TRACK audio recipe",
      });
    }
    const seq = t.movement.sequence;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i]!.at < seq[i - 1]!.at) {
        ctx.addIssue({
          code: "custom",
          path: ["movement", "sequence", i],
          message: "sequence must be ordered",
        });
      }
      if (seq[i]!.at > t.durationSeconds) {
        ctx.addIssue({
          code: "custom",
          path: ["movement", "sequence", i],
          message: "phase starts after template duration",
        });
      }
    }
    const pri = new Set<string>();
    for (const p of t.providerPreferences) {
      const key = `${p.providerId}:${p.model}`;
      if (pri.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["providerPreferences"],
          message: `duplicate preference ${key}`,
        });
      }
      pri.add(key);
    }
  });

export type TemplateSpec = z.infer<typeof templateSpecSchema>;

export function parseTemplateSpec(input: unknown): TemplateSpec {
  return templateSpecSchema.parse(input);
}

export function safeParseTemplateSpec(input: unknown) {
  return templateSpecSchema.safeParse(input);
}

/** Public projection of a template version as served to the consumer app. */
export interface PublicTemplate {
  id: string;
  slug: string;
  version: number;
  name: string;
  status: TemplateSpec["status"];
  category: TemplateSpec["category"];
  originType: TemplateSpec["origin"]["type"];
  tagline: string;
  hook: string;
  description: string;
  durationSeconds: number;
  energy: number;
  difficulty: number;
  tags: string[];
  featured: boolean;
  artwork: TemplateSpec["artwork"];
  hasPreviewVideo: boolean;
  movement: {
    firstSecond: string;
    signature: string;
    phases: { at: number; name: string }[];
    bodyFocus: TemplateSpec["movement"]["bodyFocus"];
  };
  referenceMotionStatus: ReferenceMotionStatus;
  isNew: boolean;
  createdAt: string;
}

export const DIFFICULTY_LABELS = ["", "Easy", "Chill", "Medium", "Tricky", "Hard"] as const;
export const ENERGY_LABELS = ["", "Low", "Easy", "Medium", "High", "Max"] as const;
