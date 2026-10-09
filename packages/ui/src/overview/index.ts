/**
 * Overview page vocabulary.
 *
 * A small set of section-shaped primitives, kept here rather than in the web
 * app so downstream consumers get them unchanged.
 *
 * The rules they encode: group with hairlines and vertical rhythm instead of
 * cards, spend colour on one accent plus the health bands and nothing else,
 * keep a wide type scale so hierarchy does not depend on borders, and put a
 * sentence next to every figure — a number with no frame is not information.
 */

export { OverviewSection, SectionLink } from "./section";
export type { OverviewSectionProps } from "./section";

export { HealthLede, healthBand } from "./health-lede";
export type { HealthLedeProps } from "./health-lede";
