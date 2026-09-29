import type { Metadata } from "next";
import { ProsePage } from "@/components/Prose";

export const metadata: Metadata = { title: "About AI videos" };

export default function AboutPage() {
  return (
    <ProsePage title="How it works">
      <p>
        <strong>Pick a move. Add your photo. Become the video.</strong> Each TREND MACHINE dance is a real
        performance recorded by a dancer. An AI video model transfers that movement onto the person in your
        photo.
      </p>
      <h2>Original moves</h2>
      <p>
        Our launch dances — Glitch Walk, Zero Gravity Shuffle and Rubber Legs — are original TREND MACHINE
        concepts. We don&apos;t copy viral choreography or bundle commercial music. A dance only becomes
        available once its reference performance has been recorded with the performer&apos;s permission.
      </p>
      <h2>Honest labels</h2>
      <ul>
        <li>Template artwork is a motion sketch drawn in code, not a generated video.</li>
        <li>
          We don&apos;t show fake view counts, likes or &ldquo;trending&rdquo; badges. Trending only appears
          when there&apos;s real data.
        </li>
        <li>
          Every result is labelled &ldquo;AI-generated&rdquo; in the app, on share pages and in the download
          file name.
        </li>
        <li>
          We don&apos;t currently add a visible watermark or cryptographic content credentials (C2PA) to
          videos. We record provenance (dance version, engine, time) on our side and plan to add embedded
          credentials.
        </li>
      </ul>
      <h2>If something fails</h2>
      <p>
        We&apos;ll tell you exactly why — for example if a dance hasn&apos;t been recorded yet — instead of
        showing a fake result.
      </p>
    </ProsePage>
  );
}
