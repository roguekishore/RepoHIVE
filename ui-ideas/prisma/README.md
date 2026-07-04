# Prisma — Creative Studio Landing Page

A dark, moody, cinematic single-page landing site for the fictional creative studio
**Prisma**. Built with Vite + React 18 + TypeScript + Tailwind CSS, animated with
framer-motion and iconography from lucide-react.

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + production build
npm run preview  # preview the production build
```

## Sections

- **Hero** — full-viewport inset video panel with a noise overlay, top-center navbar
  pill, a giant `Prisma*` headline (staggered word pull-up), description, and a
  `Join the lab` CTA.
- **About** — `#101010` card with a multi-style pull-up heading (Almarai + Instrument
  Serif italic) and a scroll-linked, per-character opacity reveal of the body copy.
- **Features** — four-column card grid (video card + three content cards with checklist
  items and `Learn more` links) over a subtle noise background, each card entering on
  scroll with a staggered scale/fade.

## Design system

| Token | Value |
|-------|-------|
| Background | `#000000` (global), `#101010` (About card), `#212121` (Feature cards) |
| Primary text | `#E1E0CC` (inline) / `#DEDBC8` (Tailwind `primary`) |
| Global font | Almarai (300/400/700/800) |
| Serif accent | Instrument Serif (italic) |

## Shared animation components

- `WordsPullUp` — splits text into words that slide up with staggered delay; optional
  superscript asterisk on the final word.
- `WordsPullUpMultiStyle` — same animation across an array of `{ text, className }`
  segments, preserving per-word styling.
