/**
 * The three.js pieces the Hive landing's two scenes share: the extruded rings of the hierarchy, their materials, the
 * lights and the renderer. three.js is loaded on demand by the components and handed in as `T`, so this module (and the
 * page's first paint) never waits on it. Ported from the approved Hive Core artifact, keeping its numbers; r128.
 */
import type * as THREE from "three";
import { mixColors, type CanvasPalette, type Rgba } from "../../canvas/colors";
import type { ArcKindCode } from "../landing/figures-types";
import { pieceHeight, RING, type Strata } from "./model";

export type Three = typeof THREE;

/** An sRGB colour as the linear colour three.js lights with. */
export function linear(T: Three, c: Rgba): THREE.Color {
  return new T.Color(c.r / 255, c.g / 255, c.b / 255).convertSRGBToLinear();
}

export interface PieceGeometry {
  readonly k: number;
  readonly ring: number;
  readonly files: number;
  readonly kind: ArcKindCode;
  readonly geo: THREE.ExtrudeGeometry;
}

export interface GeometrySet {
  readonly pieces: readonly PieceGeometry[];
  /** The repository: a cylinder whose base sits at y = 0. */
  readonly core: THREE.CylinderGeometry;
}

const geometryCache = new WeakMap<Strata, GeometrySet>();

/** One extruded arc per drawn piece, and the repository cylinder. Built once per page and shared by both scenes. */
export function geometryFor(T: Three, strata: Strata): GeometrySet {
  const hit = geometryCache.get(strata);
  if (hit !== undefined) return hit;
  const { r0: R0, width: RW, gap: GAP, height: HH } = RING;
  const pieces: PieceGeometry[] = [];
  strata.arcs.forEach(([ring, start, span, files, kind], k) => {
    if (!strata.drawn[k]) return;
    const r0 = R0 + (ring - 1) * (RW + GAP);
    const r1 = r0 + RW;
    const pad = Math.min(span * Math.PI * 0.25, (0.012 / r0) * 4);
    const a0 = Math.PI / 2 - start * Math.PI * 2 - pad;
    const a1 = Math.PI / 2 - (start + span) * Math.PI * 2 + pad;
    const shape = new T.Shape();
    shape.moveTo(Math.cos(a0) * r1, Math.sin(a0) * r1);
    shape.absarc(0, 0, r1, a0, a1, true);
    shape.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
    shape.absarc(0, 0, r0, a1, a0, false);
    shape.closePath();
    const geo = new T.ExtrudeGeometry(shape, {
      depth: pieceHeight(kind),
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.018,
      bevelSegments: 2,
      curveSegments: Math.max(3, Math.ceil(span * 140)),
    });
    pieces.push({ k, ring, files, kind, geo });
  });
  const core = new T.CylinderGeometry(R0 - GAP * 1.6, R0 - GAP * 1.6, HH * 2.4, 64);
  core.translate(0, HH * 1.2, 0);
  const set: GeometrySet = { pieces, core };
  geometryCache.set(strata, set);
  return set;
}

export interface Materials {
  /** By decision code: group, kept, rebuilt, too small. */
  readonly base: THREE.MeshStandardMaterial[];
  readonly dim: THREE.MeshStandardMaterial[];
  readonly core: THREE.MeshStandardMaterial;
  readonly coreDim: THREE.MeshStandardMaterial;
  readonly hot: THREE.MeshStandardMaterial;
  readonly sel: THREE.MeshStandardMaterial;
}

export function makeMaterials(T: Three): Materials {
  const make = (o?: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    new T.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const dim = (): THREE.MeshStandardMaterial => make({ transparent: true, opacity: 0.22, depthWrite: false });
  return { base: [0, 1, 2, 3].map(() => make()), dim: [0, 1, 2, 3].map(dim), core: make({ roughness: 0.8 }), coreDim: dim(), hot: make({ roughness: 0.6 }), sel: make({ roughness: 0.6 }) };
}

/** The palette entries the scene reads, by the names the artifact used. */
export function paletteColours(palette: CanvasPalette): { bg: Rgba; line: Rgba; ls: Rgba; fg: Rgba; fg2: Rgba; fg3: Rgba; acc: Rgba } {
  const c = palette.colors;
  return { bg: c.bg, line: c.line, ls: c["line-strong"], fg: c.fg, fg2: c["fg-2"], fg3: c["fg-3"], acc: c.accent };
}

/** Kept is ink, rebuilt is the accent, too small is the quiet line; groups sit between. */
export function paintMaterials(T: Three, m: Materials, palette: CanvasPalette): void {
  const P = paletteColours(palette);
  const dark = palette.scheme === "dark";
  const kinds = [mixColors(P.ls, P.fg, dark ? 0.08 : 0.04), P.fg, P.acc, P.line];
  kinds.forEach((c, i) => {
    m.base[i]!.color = linear(T, c);
    m.dim[i]!.color = linear(T, mixColors(c, P.bg, 0.35));
  });
  m.core.color = linear(T, P.fg);
  m.coreDim.color = linear(T, mixColors(P.fg, P.bg, 0.35));
  m.hot.color = linear(T, mixColors(P.acc, P.fg, 0.35));
  m.sel.color = linear(T, mixColors(P.acc, P.fg, 0.15));
  m.sel.emissive = linear(T, P.acc);
  m.sel.emissiveIntensity = 0.35;
}

export interface Strata3D {
  readonly root: THREE.Group;
  readonly rings: Record<1 | 2 | 3 | 4, THREE.Group>;
  readonly pieces: THREE.Mesh[];
  readonly core: THREE.Mesh;
}

export interface PieceData {
  readonly k: number;
  readonly ring: number;
  readonly files: number;
  readonly kind: ArcKindCode;
}

/** What a picked mesh carries: a piece, or the repository core. */
export type PickData = PieceData | { readonly core: true };
export const isCore = (d: PickData): d is { readonly core: true } => "core" in d;

export function makeStrata(T: Three, set: GeometrySet, mats: Materials): Strata3D {
  const root = new T.Group();
  const rings = { 1: new T.Group(), 2: new T.Group(), 3: new T.Group(), 4: new T.Group() };
  ([1, 2, 3, 4] as const).forEach((r) => root.add(rings[r]));
  const pieces = set.pieces.map((g) => {
    const mesh = new T.Mesh(g.geo, mats.base[g.kind]);
    mesh.rotation.x = -Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { k: g.k, ring: g.ring, files: g.files, kind: g.kind } satisfies PieceData;
    rings[g.ring as 1 | 2 | 3 | 4].add(mesh);
    return mesh;
  });
  const core = new T.Mesh(set.core, mats.core);
  core.castShadow = true;
  core.userData = { core: true };
  root.add(core);
  return { root, rings, pieces, core };
}

/** Adds the lights and the shadow ground; returns the function that sets their strength for the theme. */
export function makeLights(T: Three, scene: THREE.Scene): (dark: boolean) => void {
  const hemi = new T.HemisphereLight(0xffffff, 0x8a80a0, 0.85);
  scene.add(hemi);
  const key = new T.DirectionalLight(0xffffff, 0.9);
  key.position.set(-7, 15, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 45 });
  key.shadow.bias = -0.0008;
  scene.add(key);
  const rim = new T.DirectionalLight(0xe6dcff, 0.35);
  rim.position.set(8, 5, -7);
  scene.add(rim);
  const ground = new T.Mesh(new T.PlaneGeometry(90, 90), new T.ShadowMaterial({ opacity: 0.14 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);
  return (dark) => {
    hemi.intensity = dark ? 0.6 : 0.85;
    key.intensity = dark ? 0.85 : 0.9;
    (ground.material as THREE.ShadowMaterial).opacity = dark ? 0.42 : 0.14;
  };
}

/** The sharpest pixel ratio the scenes ask for. Beyond this the extra pixels cost more than they show. */
const MAX_PIXEL_RATIO = 1.5;
const MIN_PIXEL_RATIO = 0.75;

/**
 * A renderer on `canvas`; throws when WebGL is unavailable, which the caller turns into the fallback message.
 *
 * Shadows are only redrawn when a scene asks (`renderer.shadowMap.needsUpdate = true`): the lights never move, so a
 * frame that only turns the camera has nothing new to cast.
 */
export function makeRenderer(T: Three, canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
  const renderer = new T.WebGLRenderer({ canvas, antialias: ratio < 1.5, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(ratio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.outputEncoding = T.sRGBEncoding;
  return renderer;
}

/**
 * Returns the function a scene calls with the frame time after each draw. When frames keep running slow it lowers the
 * pixel ratio a step and calls `resize` so the drawing buffer follows. It never raises it again, so it cannot flap.
 */
export function makeGovernor(renderer: THREE.WebGLRenderer, resize: () => void): (now: number) => void {
  let last = 0;
  let sum = 0;
  let count = 0;
  return (now) => {
    const dt = now - last;
    last = now;
    if (dt > 120) {
      // Off screen, a hidden tab or a long pause: not a measure of how fast the scene draws.
      sum = 0;
      count = 0;
      return;
    }
    sum += dt;
    count += 1;
    if (count < 45) return;
    const mean = sum / count;
    sum = 0;
    count = 0;
    const ratio = renderer.getPixelRatio();
    if (mean > 26 && ratio > MIN_PIXEL_RATIO) {
      renderer.setPixelRatio(Math.max(MIN_PIXEL_RATIO, ratio * 0.8));
      resize();
    }
  };
}

/**
 * Returns the function that places a label. It writes to the DOM only when the rounded position or the opacity changed,
 * so a label that is hidden or still costs nothing per frame.
 */
export function makeTagWriter(): (el: HTMLElement, x: number, y: number, opacity: number) => void {
  const seen = new WeakMap<HTMLElement, string>();
  return (el, x, y, opacity) => {
    const left = Math.round(x);
    const top = Math.round(y);
    const op = opacity.toFixed(2);
    const key = `${left}|${top}|${op}`;
    if (seen.get(el) === key) return;
    seen.set(el, key);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.opacity = op;
  };
}

/** The label a hover tooltip shows for a picked mesh: `[before, bold, after]`. */
export function hoverText(d: PickData, repository: string, files: number, kindWords: readonly string[], numberFormat: Intl.NumberFormat): readonly [string, string, string] {
  return isCore(d)
    ? [`${repository} · `, numberFormat.format(files), " files"]
    : [`Level ${d.ring} · ${kindWords[d.kind]} · `, numberFormat.format(d.files), " files"];
}
