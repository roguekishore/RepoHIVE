import type { ReactNode, SVGAttributes } from "react";

/** The icon set: 16×16, 1.3 to 1.5 stroke, `currentColor`. Names follow the screen they stand for. */
const STROKE = "currentColor";

const GLYPHS = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" fill="none" stroke={STROKE} strokeWidth="1.4" />
      <path d="M10.5 10.5 14 14" stroke={STROKE} strokeWidth="1.4" fill="none" />
    </>
  ),
  list: (
    <>
      <rect x="2" y="2.5" width="12" height="4.5" fill="none" stroke={STROKE} strokeWidth="1.3" />
      <rect x="2" y="9" width="12" height="4.5" fill="none" stroke={STROKE} strokeWidth="1.3" />
    </>
  ),
  activity: <path d="M1.5 8h3l2-5 3 10 2-5h3" stroke={STROKE} strokeWidth="1.4" fill="none" strokeLinejoin="round" />,
  book: (
    <path
      d="M3 2.5h7.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2zM3 11.5a2 2 0 0 1 2-2h7.5"
      stroke={STROKE}
      strokeWidth="1.4"
      fill="none"
    />
  ),
  overview: (
    <>
      <rect x="2" y="2" width="12" height="12" fill="none" stroke={STROKE} strokeWidth="1.4" />
      <path d="M2 7h12M7 7v7" stroke={STROKE} strokeWidth="1.4" />
    </>
  ),
  map: (
    <>
      <rect x="1.5" y="2.5" width="6" height="4.5" fill="none" stroke={STROKE} strokeWidth="1.3" />
      <rect x="9" y="2.5" width="5.5" height="4.5" fill="none" stroke={STROKE} strokeWidth="1.3" />
      <rect x="1.5" y="9" width="13" height="4.5" fill="none" stroke={STROKE} strokeWidth="1.3" />
    </>
  ),
  hierarchy: (
    <>
      <circle cx="8" cy="8" r="2" fill="none" stroke={STROKE} strokeWidth="1.3" />
      <path d="M8 2a6 6 0 0 1 6 6M2 8a6 6 0 0 1 6-6M8 14a6 6 0 0 1-6-6" stroke={STROKE} strokeWidth="1.3" fill="none" />
    </>
  ),
  decide: (
    <>
      <rect x="2" y="2" width="5" height="5" fill="none" stroke={STROKE} strokeWidth="1.4" />
      <rect x="9" y="9" width="5" height="5" fill="none" stroke={STROKE} strokeWidth="1.4" strokeDasharray="2 1.5" />
      <path d="M7 4.5h2.5V9" stroke={STROKE} strokeWidth="1.4" fill="none" />
    </>
  ),
  layers: (
    <path
      d="M8 2 14 5 8 8 2 5zM2 8.5l6 3 6-3M2 11.5l6 3 6-3"
      stroke={STROKE}
      strokeWidth="1.3"
      fill="none"
      strokeLinejoin="round"
    />
  ),
  graph: (
    <>
      <circle cx="4" cy="4" r="1.6" fill={STROKE} />
      <circle cx="12" cy="5" r="1.6" fill={STROKE} />
      <circle cx="6" cy="12" r="1.6" fill={STROKE} />
      <circle cx="12.5" cy="12" r="1.6" fill={STROKE} />
      <path d="M4 4l8 1M4 4l2 8M12 5l-6 7M12 5l.5 7M6 12h6.5" stroke={STROKE} strokeWidth="1" />
    </>
  ),
  compare: <path d="M2 14V9M6 14V5M10 14V7M14 14V2" stroke={STROKE} strokeWidth="1.6" />,
  circles: (
    <>
      <circle cx="6" cy="6.5" r="3.8" fill="none" stroke={STROKE} strokeWidth="1.3" />
      <circle cx="10.5" cy="9.5" r="3.8" fill="none" stroke={STROKE} strokeWidth="1.3" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.8" fill="none" stroke={STROKE} strokeWidth="1.3" />
      <path d="M2.5 14c.7-2.8 2.9-4.2 5.5-4.2s4.8 1.4 5.5 4.2" fill="none" stroke={STROKE} strokeWidth="1.3" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" stroke={STROKE} strokeWidth="1.5" />,
  minus: <path d="M3 8h10" stroke={STROKE} strokeWidth="1.5" />,
  fit: <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" stroke={STROKE} strokeWidth="1.4" fill="none" />,
  x: <path d="M4 4l8 8M12 4l-8 8" stroke={STROKE} strokeWidth="1.4" />,
  menu: <path d="M2 4h12M2 8h12M2 12h12" stroke={STROKE} strokeWidth="1.4" />,
  file: <path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" stroke={STROKE} strokeWidth="1.3" fill="none" />,
  region: (
    <rect x="2" y="2" width="12" height="12" fill="none" stroke={STROKE} strokeWidth="1.3" strokeDasharray="2.5 1.5" />
  ),
  repo: <path d="M3.5 2.5h9v11h-9zM6 2.5v11" stroke={STROKE} strokeWidth="1.3" fill="none" />,
  refresh: <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" stroke={STROKE} strokeWidth="1.4" fill="none" />,
  arrow: <path d="M3 8h10M9 4l4 4-4 4" stroke={STROKE} strokeWidth="1.4" fill="none" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof GLYPHS;

export const ICON_NAMES = Object.keys(GLYPHS) as readonly IconName[];

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "viewBox" | "children"> {
  readonly name: IconName;
  /** Pixels; the glyphs are drawn on a 16 grid. */
  readonly size?: number;
  /** Set when the icon carries meaning by itself; otherwise it is hidden from assistive technology. */
  readonly label?: string;
}

export function Icon({ name, size = 16, label, ...rest }: IconProps) {
  const labelled = label === undefined ? { "aria-hidden": true as const } : { role: "img" as const, "aria-label": label };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" focusable="false" {...labelled} {...rest}>
      {GLYPHS[name]}
    </svg>
  );
}
