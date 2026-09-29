import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: { default: "TREND MACHINE — Make the next move", template: "%s · TREND MACHINE" },
  description:
    "Pick a move. Add your photo. Become the video. AI dance videos from original TREND MACHINE moves.",
  applicationName: "TREND MACHINE",
  appleWebApp: { capable: true, title: "TREND MACHINE", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  robots: { index: true, follow: true },
  icons: {
    icon: [{ url: "/icons/192", type: "image/png" }],
    apple: [{ url: "/icons/apple", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07070a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="min-h-dvh">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
