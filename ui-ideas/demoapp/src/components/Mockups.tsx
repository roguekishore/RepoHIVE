/*
 * Abstract SVG visuals for the split-feature rows.
 * Colors come from CSS tokens via currentColor / CSS vars (no hardcoded hex).
 */

const v = (name: string) => `var(--color-${name})`;

export function GraphViz() {
  // central node + spokes, mirroring the reference dependency-graph visual
  const nodes = [
    { x: 180, y: 90, r: 22, c: "accent-bright" },
    { x: 70, y: 40, r: 12, c: "sage" },
    { x: 300, y: 55, r: 14, c: "sage" },
    { x: 320, y: 150, r: 12, c: "violet" },
    { x: 200, y: 190, r: 14, c: "red" },
    { x: 60, y: 150, r: 12, c: "sage" },
    { x: 120, y: 200, r: 10, c: "sage" },
  ];
  return (
    <div className="viz">
      <svg viewBox="0 0 380 220" fill="none">
        <defs>
          <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {nodes.slice(1).map((n, i) => (
          <line
            key={i}
            x1={nodes[0].x}
            y1={nodes[0].y}
            x2={n.x}
            y2={n.y}
            stroke={v("accent-line")}
            strokeWidth="1"
          />
        ))}
        {nodes.map((n, i) => (
          <circle
            key={i}
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={v(n.c)}
            opacity={i === 0 ? 1 : 0.85}
            filter={i === 0 ? "url(#nodeGlow)" : undefined}
          />
        ))}
      </svg>
    </div>
  );
}

export function HealthViz() {
  const bars = [
    { label: "auth/Middleware.java", val: 0.46, c: "accent-bright", score: "4.6" },
    { label: "api/Routes.java", val: 0.72, c: "green", score: "7.2" },
    { label: "core/Models.java", val: 0.89, c: "green", score: "8.9" },
  ];
  return (
    <div className="viz">
      <svg viewBox="0 0 380 220" fill="none" fontFamily="var(--font-mono)">
        <rect x="0" y="0" width="380" height="60" rx="8" fill={v("surface-3")} />
        <text x="16" y="30" fill={v("text-body")} fontSize="11">core/Region.java</text>
        <text x="16" y="48" fill={v("accent-bright")} fontSize="22" fontWeight="600">3.1</text>
        <text x="60" y="48" fill={v("text-muted")} fontSize="11">/ 10 cohesion</text>
        <text x="250" y="34" fill={v("red")} fontSize="9">RECONSTRUCT</text>
        {bars.map((b, i) => {
          const y = 90 + i * 38;
          return (
            <g key={i}>
              <text x="0" y={y - 4} fill={v("text-muted")} fontSize="10">{b.label}</text>
              <rect x="0" y={y} width="300" height="6" rx="3" fill={v("surface-3")} />
              <rect x="0" y={y} width={300 * b.val} height="6" rx="3" fill={v(b.c)} />
              <text x="312" y={y + 7} fill={v(b.c)} fontSize="10">{b.score}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function GitViz() {
  const commits = [
    { y: 30, label: "preserve src/auth", active: false },
    { y: 62, label: "reconstruct src/util", active: true },
    { y: 94, label: "preserve src/api", active: false },
    { y: 126, label: "reconstruct legacy/", active: false },
    { y: 158, label: "merge regions", active: false },
  ];
  return (
    <div className="viz">
      <svg viewBox="0 0 380 200" fill="none" fontFamily="var(--font-mono)">
        <line x1="20" y1="20" x2="20" y2="170" stroke={v("border-strong")} strokeWidth="1" />
        {commits.map((c, i) => (
          <g key={i}>
            <circle cx="20" cy={c.y} r={c.active ? 7 : 4} fill={c.active ? v("accent-bright") : v("text-faint")} />
            <rect x="40" y={c.y - 9} width="160" height="18" rx="4" fill={c.active ? v("accent-soft") : v("surface-3")} />
            <text x="50" y={c.y + 3} fill={c.active ? v("accent-bright") : v("text-muted")} fontSize="9">{c.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function WikiViz() {
  return (
    <div className="viz">
      <svg viewBox="0 0 380 220" fill="none" fontFamily="var(--font-mono)">
        {/* hierarchy tree: repo -> groups -> files */}
        <rect x="150" y="10" width="80" height="22" rx="5" fill={v("accent-soft")} stroke={v("accent-line")} />
        <text x="172" y="25" fill={v("accent-bright")} fontSize="9">repo</text>
        {[60, 190, 320].map((x, i) => (
          <g key={i}>
            <line x1="190" y1="32" x2={x + 35} y2="70" stroke={v("border-strong")} strokeWidth="1" />
            <rect x={x} y="70" width="70" height="20" rx="5" fill={v("surface-3")} />
            <text x={x + 12} y="84" fill={v("text-body")} fontSize="9">group {i + 1}</text>
            {[0, 1].map((j) => (
              <g key={j}>
                <line x1={x + 35} y1="90" x2={x + 18 + j * 34} y2="125" stroke={v("border")} strokeWidth="1" />
                <rect x={x + j * 34} y="125" width="30" height="16" rx="3" fill={v("surface-2")} stroke={v("border")} />
              </g>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

const map = { graph: GraphViz, health: HealthViz, git: GitViz, wiki: WikiViz, decisions: GitViz };

export function Mockup({ kind }: { kind: keyof typeof map }) {
  const Comp = map[kind];
  return <Comp />;
}
