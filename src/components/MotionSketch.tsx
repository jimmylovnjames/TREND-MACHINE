import type { CSSProperties } from "react";
import type { TemplateSpec } from "@/domain/template";

/**
 * Original, code-drawn motion sketch used as template artwork until real preview
 * footage exists. It is labelled as a sketch in the UI — never presented as a
 * generated result or a real performance.
 */
export function MotionSketch({
  motif,
  palette,
  label,
  className = "",
  showLabel = true,
  paused = false,
}: {
  motif: TemplateSpec["artwork"]["motif"];
  palette: TemplateSpec["artwork"]["palette"];
  label: string;
  className?: string;
  showLabel?: boolean;
  paused?: boolean;
}) {
  const [a, b, c] = palette;
  const play: CSSProperties["animationPlayState"] = paused ? "paused" : "running";
  const anim = (name: string, dur: number, timing = "linear", origin = "45px 80px"): CSSProperties => ({
    animation: `${name} ${dur}s ${timing} infinite`,
    animationPlayState: play,
    transformOrigin: origin,
    transformBox: "view-box",
  });

  return (
    <div className={`relative overflow-hidden bg-surface ${className}`} aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 70% at 50% 100%, ${a}33 0%, transparent 60%), radial-gradient(90% 50% at 90% 0%, ${b}29 0%, transparent 60%), linear-gradient(180deg, #0c0c12 0%, #07070a 100%)`,
        }}
      />
      <svg
        viewBox="0 0 90 160"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <pattern id={`grid-${motif}`} width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0H0V10" fill="none" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="0.4" />
          </pattern>
        </defs>
        <rect width="90" height="160" fill={`url(#grid-${motif})`} />
        {/* floor */}
        <ellipse cx="45" cy="132" rx="22" ry="3" fill={a} opacity="0.18" />
        {motif === "glitch" && (
          <>
            <g style={anim("glitch-split", 2.4, "steps(1)")} opacity="0">
              <Figure
                color={b}
                legAnim={anim("leg-a", 0.6, "steps(3)", "45px 86px")}
                legAnim2={anim("leg-b", 0.6, "steps(3)", "45px 86px")}
                armAnim={anim("arm-a", 0.6, "steps(3)", "45px 58px")}
              />
            </g>
            <g style={anim("glitch-walk", 2.4, "steps(1)")}>
              <Figure
                color={a}
                legAnim={anim("leg-a", 0.6, "steps(3)", "45px 86px")}
                legAnim2={anim("leg-b", 0.6, "steps(3)", "45px 86px")}
                armAnim={anim("arm-a", 0.6, "steps(3)", "45px 58px")}
              />
            </g>
            <rect
              width="90"
              height="14"
              fill={c}
              opacity="0.06"
              style={{ ...anim("scan", 2.2), transformOrigin: "0 0" }}
            />
          </>
        )}
        {motif === "float" && (
          <>
            {[12, 26, 70, 80, 60, 18].map((x, i) => (
              <circle key={i} cx={x} cy={20 + i * 17} r={0.8} fill={c} opacity={0.5} />
            ))}
            <g style={anim("float-body", 4, "cubic-bezier(.45,.05,.55,.95)")}>
              <Figure
                color={a}
                accent={b}
                legAnim={anim("leg-a", 2, "ease-in-out", "45px 86px")}
                legAnim2={anim("leg-b", 2, "ease-in-out", "45px 86px")}
                armAnim={anim("float-arms", 4, "ease-in-out", "45px 58px")}
                armAnim2={anim("float-arms", 4, "ease-in-out", "45px 58px")}
                mirrorArm2
              />
            </g>
          </>
        )}
        {motif === "rubber" && (
          <g style={anim("rubber-body", 1.8, "cubic-bezier(.3,1.6,.5,1)")}>
            <RubberFigure
              color={a}
              accent={b}
              kneeL={anim("rubber-knee-l", 1.8, "cubic-bezier(.3,1.6,.5,1)", "38px 106px")}
              kneeR={anim("rubber-knee-r", 1.8, "cubic-bezier(.3,1.6,.5,1)", "52px 106px")}
            />
          </g>
        )}
      </svg>
      {showLabel && (
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Motion sketch
        </span>
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}

function Figure({
  color,
  accent,
  legAnim,
  legAnim2,
  armAnim,
  armAnim2,
  mirrorArm2,
}: {
  color: string;
  accent?: string;
  legAnim: CSSProperties;
  legAnim2: CSSProperties;
  armAnim: CSSProperties;
  armAnim2?: CSSProperties;
  mirrorArm2?: boolean;
}) {
  const stroke = { stroke: color, strokeWidth: 5, strokeLinecap: "round" as const, fill: "none" };
  return (
    <g>
      <circle cx="45" cy="44" r="7" fill={color} />
      <line x1="45" y1="54" x2="45" y2="86" {...stroke} />
      <g style={armAnim}>
        <line x1="45" y1="58" x2="33" y2="80" {...stroke} />
      </g>
      <g
        style={armAnim2 ?? { ...armAnim, animationDirection: "reverse" }}
        transform={mirrorArm2 ? "matrix(-1 0 0 1 90 0)" : undefined}
      >
        <line x1="45" y1="58" x2="57" y2="80" {...stroke} stroke={accent ?? color} />
      </g>
      <g style={legAnim}>
        <line x1="45" y1="86" x2="40" y2="130" {...stroke} />
      </g>
      <g style={legAnim2}>
        <line x1="45" y1="86" x2="50" y2="130" {...stroke} stroke={accent ?? color} />
      </g>
    </g>
  );
}

function RubberFigure({
  color,
  accent,
  kneeL,
  kneeR,
}: {
  color: string;
  accent: string;
  kneeL: CSSProperties;
  kneeR: CSSProperties;
}) {
  const stroke = {
    stroke: color,
    strokeWidth: 5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  return (
    <g>
      <circle cx="45" cy="44" r="7" fill={color} />
      <line x1="45" y1="54" x2="45" y2="86" {...stroke} />
      {/* composed upper body: hands in pockets */}
      <polyline points="45,60 36,72 39,86" {...stroke} />
      <polyline points="45,60 54,72 51,86" {...stroke} />
      <line x1="45" y1="86" x2="38" y2="106" {...stroke} />
      <line x1="45" y1="86" x2="52" y2="106" {...stroke} />
      <g style={kneeL}>
        <line x1="38" y1="106" x2="36" y2="130" {...stroke} stroke={accent} />
      </g>
      <g style={kneeR}>
        <line x1="52" y1="106" x2="54" y2="130" {...stroke} stroke={accent} />
      </g>
    </g>
  );
}
