import { ImageResponse } from "next/og";

const VARIANTS: Record<string, { size: number; pad: number }> = {
  "192": { size: 192, pad: 0 },
  "512": { size: 512, pad: 0 },
  "512-maskable": { size: 512, pad: 0.12 },
  apple: { size: 180, pad: 0 },
};

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

/** App icon drawn in code: a "TM" monogram with chromatic offset. */
export async function GET(_req: Request, ctx: { params: Promise<{ variant: string }> }) {
  const { variant } = await ctx.params;
  const v = VARIANTS[variant];
  if (!v) return new Response("Not found", { status: 404 });
  const s = v.size;
  const fs = Math.round(s * (0.46 - v.pad * 0.6));
  const layer = (color: string, dx: number, dy: number) => (
    <div
      style={{
        position: "absolute",
        display: "flex",
        fontSize: fs,
        fontWeight: 900,
        color,
        letterSpacing: -fs * 0.06,
        transform: `translate(${dx}px, ${dy}px)`,
      }}
    >
      TM
    </div>
  );
  return new ImageResponse(
    <div
      style={{
        width: s,
        height: s,
        background: "#07070a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      {layer("#ff2e88", -s * 0.018, s * 0.01)}
      {layer("#00e5ff", s * 0.018, -s * 0.01)}
      {layer("#c6ff00", 0, 0)}
    </div>,
    { width: s, height: s, headers: { "Cache-Control": "public, max-age=604800, immutable" } },
  );
}
