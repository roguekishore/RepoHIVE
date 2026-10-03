/**
 * What counts as "the weekend" when reading the coding-rhythm heatmap.
 *
 * Saturday/Sunday is not universal — much of the Middle East rests Friday and
 * Saturday, and a few countries Thursday/Friday — so a hardcoded Sat/Sun share
 * silently misreports those teams. The punch-card matrix already carries every
 * weekday total, so the share is derived here from the reader's preference
 * rather than baked in by the server.
 */

/** Weekday indices as the punch-card matrix stores them: 0 = Monday. */
interface WeekendPreset {
  id: string;
  label: string;
  days: readonly number[];
}

export const WEEKEND_PRESETS: readonly WeekendPreset[] = [
  { id: "sat-sun", label: "Saturday & Sunday", days: [5, 6] },
  { id: "fri-sat", label: "Friday & Saturday", days: [4, 5] },
  { id: "thu-fri", label: "Thursday & Friday", days: [3, 4] },
  { id: "fri", label: "Friday only", days: [4] },
  { id: "sun", label: "Sunday only", days: [6] },
];

export const DEFAULT_WEEKEND_PRESET = WEEKEND_PRESETS[0]!;
