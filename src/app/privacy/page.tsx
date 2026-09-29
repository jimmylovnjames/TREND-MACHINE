import type { Metadata } from "next";
import { ProsePage } from "@/components/Prose";

export const metadata: Metadata = { title: "Privacy & retention" };

export default function PrivacyPage() {
  return (
    <ProsePage title="Privacy & retention">
      <p>
        TREND MACHINE turns one photo into a short AI dance video. Here is exactly what happens to your data.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your photo</strong> — the cropped image you upload. Location and camera metadata (EXIF/XMP)
          is removed on your device and again on our server.
        </li>
        <li>
          <strong>Your generated video.</strong>
        </li>
        <li>
          <strong>An anonymous device cookie</strong> so you can see your own videos. No account, name, email
          or phone number.
        </li>
        <li>
          <strong>Product analytics</strong> — which dances are viewed and generated, errors and timings, tied
          to a pseudonymous id. No photos, no free text, no precise location. IP addresses are only used as a
          daily-rotating hash for abuse limits.
        </li>
      </ul>
      <h2>Why</h2>
      <p>
        Only to make your video, let you download and share it, prevent abuse, control costs and improve which
        dances we build.
      </p>
      <h2>Who receives your photo</h2>
      <p>
        Your photo is sent to the AI video-generation provider that renders your dance (currently Higgsfield
        running Kling Motion Control, or Viggle as a fallback, depending on configuration). They process it to
        make the video under their own terms and retention rules; Higgsfield documents that uploaded inputs
        are stored as temporary files. We never sell your photo or video.
      </p>
      <h2>How long we keep it</h2>
      <ul>
        <li>
          <strong>Photos:</strong> automatically deleted 24 hours after upload (so you can regenerate without
          re-uploading).
        </li>
        <li>
          <strong>Videos:</strong> automatically deleted 30 days after they are made. Share links stop working
          when the video is deleted.
        </li>
        <li>
          <strong>Analytics events:</strong> kept in pseudonymous form to measure product performance.
        </li>
      </ul>
      <h2>Deleting your data</h2>
      <p>
        Go to <strong>My videos → Delete my data</strong> to delete every photo, video and share link from
        this device immediately. You can also delete a single video from its page. Share links can be revoked
        at any time.
      </p>
      <h2>Your responsibility</h2>
      <p>
        Only upload photos of yourself or of people who have agreed. Every video is labelled as AI-generated.
      </p>
    </ProsePage>
  );
}
