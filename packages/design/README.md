# @repohive/design

The design package for RepoHIVE: tokens, components, the mark, the app frame, and the contract every screen receives.
Identity: **Kernel · Ultraviolet** (Host Grotesk, Geist Mono, the Ultraviolet palette). Plan and decisions:
`context/specs/own-identity/plan.md` (private mount); the rules below are the ones the code enforces.

It is TypeScript source and CSS, with no build step. A host compiles it (Next.js: `transpilePackages`).

## Rules

1. **It imports nothing from Next.js and fetches nothing.** Links, navigation and data come in through
   `DesignProvider` (`Link`, `navigate`, `client`).
2. **Tokens only.** Every colour, font family, size, radius, spacing step and motion value is a custom property in
   `src/styles/tokens.css`. `src/gates/tokens-only.test.ts` fails on a literal colour, font family or font size
   anywhere else.
3. **A fixed contract.** `src/contracts` defines the shapes screens receive and the `ContractClient` a host implements.
   View bodies are type-only imports from `@repohive/views`. `contracts.test-d.ts` pins the contract to the types the
   servers and the view builders use.
4. **Canvases read tokens at run time** through `useCanvasPalette()` (or `readPalette` outside React) and repaint when
   the theme changes. Nothing draws with a hard-coded colour.
5. **It must be byte-identical on both hosts** (the TS branch and the Java branch).

## Using it

```tsx
import "@repohive/design/styles.css";
import { DesignProvider, AppFrame } from "@repohive/design";

<DesignProvider Link={NextLink} navigate={(href) => router.push(href)} client={client}>
  <AppFrame pathname={pathname} crumbs={[{ label: "Repositories" }]} signedIn={signedIn} quota={quota} paletteGroups={groups}>
    {screen}
  </AppFrame>
</DesignProvider>
```

- **Fonts.** The host loads Host Grotesk and Geist Mono and sets `--font-host-grotesk` and `--font-geist-mono`
  (`next/font` does this). `tokens.css` falls back to the installed faces by name.
- **Theme.** Light, dark and system; the choice is stored under `repohive-theme`. To avoid a flash, put
  `themeInitScript` in the document head.
- **A canvas** takes its colours from the palette: `const palette = useCanvasPalette()` gives `undefined` until mounted,
  then `palette.colors.accent` and friends as `{ r, g, b, a }`, plus `palette.sans`, `palette.mono` and
  `palette.scheme`. Format with `rgbaCss`, blend with `mixColors`.
- **Routes** live in `src/routes.ts`. The same map serves both hosts.

## Changing the design system

Edit `src/styles/tokens.css` (the palette, the faces, the type scale, the frame sizes) and the host's font loading.
Components do not change. Then run the package's tests: they check that the light and dark blocks define the same
tokens, that every name in `src/tokens/names.ts` exists, that every `var(--rh-*)` the styles read is defined, and that
the scale still has eight sizes with line heights on a 4px grid.

## Tests

```
npm test --workspace @repohive/design
```

Runs `tsc --noEmit` (which checks the type tests) and then Vitest in jsdom. It needs the root build first (`npm run
build`), because the contract imports types from `@repohive/views` and `@repohive/indexer`'s `dist/`. jsdom has no
layout and no CSS custom properties, so what a real browser does with the tokens (OKLCH, the canvas resolver, layout)
is not covered by these tests; check it in a browser.
