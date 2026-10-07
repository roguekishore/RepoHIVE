import type { Decision } from "../../components/status";

/** What a region's id is called when it is shown: the id without its scheme prefix (`pkg:com.example.core` becomes `com.example.core`). */
export function regionName(regionId: string): string {
  const colon = regionId.indexOf(":");
  return colon < 0 ? regionId : regionId.slice(colon + 1);
}

/** The last segment of a region's name, for a short label. */
export function regionShortName(regionId: string): string {
  const name = regionName(regionId);
  return name.split(/[./]/).pop() ?? name;
}

/** The engine's recorded action, as the product words it. `degenerate` is a region that was never assessed. */
export function decisionOf(state: "preserve" | "reconstruct" | "degenerate" | "none"): Decision | undefined {
  switch (state) {
    case "preserve":
      return "kept";
    case "reconstruct":
      return "rebuilt";
    case "degenerate":
      return "unassessed";
    case "none":
      return undefined;
  }
}

/** A number with thousands separators, fixed to the English locale so server and browser agree. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
