# @repohive/ui

Shared visualization components for the RepoHIVE viewer
(`packages/web`) and any downstream consumer that wants to render the
same engine artifacts.

## Layout

```
src/
  docs/          docs-mode-badge
  graph/         graph-flow (Sigma), canvas shell, community and doc panels (+ sigma/)
  health/        biomarker chips and glossary, code-health map, trend and signal panels
  hooks/         use-debounce
  lib/           cn, format, confidence, errors, command-palette scope
  onboarding/    add-repo-wizard
  overview/      section, health-lede
  repohive/      adaptivity, decision and fragmentation views
  settings/      general-form, settings primitives
  shared/        primitives: adaptive-panel, breadcrumb, context-drawer, empty-state,
                 info-tip, brand-mark, owl-loader, entity links/hover cards, ...
  stats/         weekend
  ui/            Radix-CVA primitives
  wiki/          confidence-badge, mermaid-diagram
  zoom/          ZoomCanvas and its camera, culling and drawing helpers
styles/
  globals.css    canonical design tokens (Tailwind v4 @theme)
```

## Consuming

Components are exposed via subpath exports — import the slice you need
rather than the barrel:

```ts
import { HotspotTable } from "@repohive/ui/git";
import { GraphFlow } from "@repohive/ui/graph";
import { ResponsiveTable, AdaptivePanel, Toaster, toast } from "@repohive/ui/shared";
```

Consumers must add `transpilePackages: ["@repohive/ui", "@repohive/types"]`
to their `next.config.ts` (Tailwind v4 + TS source ship as-is, no
pre-build step).

To inherit the canonical design tokens, import the stylesheet once at
the root of the app:

```css
@import "@repohive/ui/styles.css";
```

## Shared primitives

- **`ResponsiveTable`** — the table primitive every list surface should
  build on. Columns declare a `priority` (1 always visible, 2 hidden
  below `md`, 3 hidden below `lg`); the wrapper always falls back to
  `overflow-x-auto`, and `stacked` collapses the table into cards on
  phones.
- **`AdaptivePanel`** — one overlay surface: right-side panel on
  desktop, swipe-dismissable bottom sheet on mobile. `ContextDrawer`
  and the chat `ArtifactPanel` are built on it.
- **`Toaster` / `toast`** — token-themed sonner toaster (uses
  `--z-toast`). Mount the `Toaster` once at the app shell; the host
  passes the resolved theme.
- **`ErrorBoundary`** — recoverable render-error boundary; default
  fallback is `ApiError` with a reset retry.
- **`EmptyState`** — the only sanctioned empty-state rendering. No raw
  `<p>` placeholders.
- Score colors come from `health/tokens.ts`. The canonical health *buckets*
  are the 3 defect-backed bands in `@repohive/types/health`
  (`HealthBand` — Alert/Warning/Healthy at `<4 / 4–8 / ≥8`); use
  `healthBandSoftBadgeClass` / `healthBandTextColor` for band colors. The
  `scoreBand` / `scoreBadgeClass` / `scoreSoftBadgeClass` / `scoreTextColor`
  helpers are an internal 4-step color ramp (`<4 / <6 / <8 / ≥8`) for
  file-table pills only — not a labeling scheme — mapped to the semantic
  tokens (`--color-error/warning/caution/success`).

## Peer deps

`react`, `react-dom`, `next-themes` (theme resolution only). Components
stay client-pure or pure-presentational — they do not call
`next/navigation` or `next/link` directly. Where routing is needed,
accept it via props (`renderLink` render props, `LinkComponent`,
`buildHref`) or context so consumers can wire their own router. New
components must not read `window.location`; initial state arrives via
props.
