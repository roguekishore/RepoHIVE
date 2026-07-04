# ui-ideas — UI / Landing-Page Explorations

> **Status: experimental scratch space. NOT part of the RepoHIVE product** and unrelated to the
> `packages/` engine. These are standalone UI/layout explorations built to explore branding, landing
> pages, and onboarding visuals. They are git-ignored candidates and may be kept, reworked, or deleted.
> Nothing here is wired into the engine pipeline (`parse → group → view`).

## Inventory

| Folder | Theme / purpose | Stack | RepoHIVE-themed? |
|--------|-----------------|-------|------------------|
| `demoapp/` | RepoHIVE demo landing page; layout mirrors a reference landing structure, copy drawn from steering docs | Vite + React + TS | Yes |
| `landing1/` | "Aeon" — single-file CDN landing experiment (visual/animation reference) | CDN React + Tailwind + Framer Motion (one index.html) | No (generic theme) |
| `landing2/` | Landing-page layout exploration | Vite + React + TS + Tailwind + Framer Motion | TBD |
| `landing4/` | Landing-page layout exploration | Vite + React + TS + Tailwind + lucide-react | TBD |
| `portal/` | Portal/dashboard-style layout exploration | Vite + React + TS + Tailwind + lucide-react | TBD |
| `prisma/` | "Prisma" — fictional creative-studio landing (visual/animation reference) | Vite + React + TS + Tailwind + Framer Motion + lucide-react | No (unrelated theme) |

## Notes

- These were produced during UI exploration sessions. Only `demoapp/` currently carries RepoHIVE
  branding/content; the others are layout/animation references using placeholder or unrelated themes.
- **Decision pending:** which (if any) of these becomes the basis for the real `packages/web` viewer.
  Until then they live here as references, not product code.
- `node_modules/` and `dist/` in these folders are build artifacts (git-ignored).
