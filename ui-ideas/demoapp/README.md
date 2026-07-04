# RepoHIVE — Demo Landing Page

> Standalone demo. **Not part of the RepoHIVE product** and unrelated to the `packages/` engine.
> Built only to explore onboarding UI. Landing page only — no other routes.

## What this is

A single landing page whose **layout and color system mirror the structure of the
`repowise.dev` landing page** (used purely as a visual layout reference). All **content is
RepoHIVE's own**, drawn from the project's steering docs. Navigation labels are placeholders.

## Design principles

- **No hardcoded styles.** Every color, font, size, spacing, radius, and motion value is a
  CSS custom property in `src/styles/tokens.css`. Re-theme the whole page from that one file.
- **No hardcoded copy.** All text lives in `src/content.ts`. Components only read from it.

## Run

```bash
npm install
npm run dev      # start the dev server (Vite)
npm run build    # type-check + production build
```

## Structure

```
src/
├── content.ts            all page copy (RepoHIVE content + placeholder nav)
├── App.tsx               section components, assembled from content.ts
├── components/Mockups.tsx token-colored SVG dashboard visuals
└── styles/
    ├── tokens.css        ← single source of truth for ALL visual values
    ├── global.css        base + reusable primitives
    └── components.css     section layout
```
