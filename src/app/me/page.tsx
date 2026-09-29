import type { Metadata } from "next";
import { MyVideos } from "@/components/MyVideos";

export const metadata: Metadata = { title: "My videos", robots: { index: false } };

export default function MePage() {
  return <MyVideos />;
}
