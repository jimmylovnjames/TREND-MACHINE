import { z } from "zod";

/**
 * Analytics event vocabulary.
 *
 * CLIENT events may be sent by the browser. SERVER events are emitted only by the
 * server (the source of truth for generation lifecycle) and are rejected if a
 * client tries to send them.
 */
export const CLIENT_EVENTS = [
  "app_open",
  "template_impression",
  "template_view",
  "template_selected",
  "upload_started",
  "upload_completed",
  "regenerate",
  "result_play",
  "download",
  "share",
] as const;

export const SERVER_EVENTS = [
  "generation_requested",
  "generation_queued",
  "generation_processing",
  "generation_completed",
  "generation_failed",
  "share_link_opened",
] as const;

export const ANALYTICS_EVENTS = [...CLIENT_EVENTS, ...SERVER_EVENTS] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];
export type ClientEventName = (typeof CLIENT_EVENTS)[number];

export const DEVICE_CLASSES = ["mobile", "tablet", "desktop", "unknown"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/**
 * Props are a closed, small whitelist: no free text, no URLs, no PII.
 */
const clientProps = z
  .object({
    surface: z.enum(["home", "detail", "make", "result", "share", "me"]).optional(),
    section: z.enum(["featured", "trending", "new", "originals"]).optional(),
    position: z.number().int().min(0).max(500).optional(),
    method: z.enum(["native", "copy_link", "download"]).optional(),
    source: z.enum(["gallery", "camera", "file"]).optional(),
    installed: z.boolean().optional(),
  })
  .strict();

export const clientEventSchema = z
  .object({
    name: z.enum(CLIENT_EVENTS),
    at: z.number().int().positive(),
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
    templateId: z
      .string()
      .regex(/^tpl_[a-z0-9_]+$/)
      .optional(),
    templateVersion: z.number().int().min(1).max(100000).optional(),
    jobId: z.string().uuid().optional(),
    props: clientProps.optional(),
  })
  .strict();

export const clientEventBatchSchema = z
  .object({ events: z.array(clientEventSchema).min(1).max(50) })
  .strict();

export type ClientEvent = z.infer<typeof clientEventSchema>;
