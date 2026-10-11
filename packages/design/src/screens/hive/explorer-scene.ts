/**
 * The explorer's scene: the same extruded rings as the animation's last step, but under the visitor's hands. Drag or
 * arrow keys turn and tilt it, the spread pulls the levels apart, a level can stand alone, and a click follows one
 * piece's branch from the repository down. The component owns the controls and the readout; this owns the GPU and
 * reports through callbacks. Returns `undefined` when WebGL is unavailable.
 *
 * Ported from the approved Hive Core artifact, keeping its numbers.
 */
import type * as THREE from "three";
import type { LandingFigures } from "../landing/figures-types";
import type { TipApi } from "./context";
import { branchOf, clamp, KIND_WORDS, number, readoutFor, RING, type Readout, type Strata } from "./model";
import { prefersReducedMotion, watchScopedPalette } from "./palette";
import { geometryFor, hoverText, isCore, makeGovernor, makeLights, makeMaterials, makeRenderer, makeStrata, makeTagWriter, paintMaterials, type Materials, type PickData, type Three } from "./scene";

export interface ExplorerHandle {
  setSpread(spread: number): void;
  setLevel(level: number): void;
  /** A camera elevation in radians, from a view preset. */
  setElevation(elevation: number): void;
  /** Multiplies the camera distance (below 1 is closer). */
  zoomBy(factor: number): void;
  reset(): void;
  setInView(inView: boolean): void;
}

export interface ExplorerOptions {
  readonly T: Three;
  readonly figures: LandingFigures;
  readonly strata: Strata;
  readonly canvas: HTMLCanvasElement;
  readonly stage: HTMLElement;
  /** One label per ring, the repository first. */
  readonly tags: readonly HTMLElement[];
  readonly root: HTMLElement;
  readonly tip: TipApi;
  readonly onRead: (readout: Readout) => void;
  /** The elevation no longer matches a preset (the visitor dragged or tilted). */
  readonly onFreeView: () => void;
}

const TIP_OWNER = "xp";
const EL_MIN = 0.08;
const EL_MAX = 1.5;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.6;

export function startExplorerScene(o: ExplorerOptions): { handle: ExplorerHandle; stop: () => void } | undefined {
  const { T, figures, strata: S, canvas: cv, stage } = o;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = makeRenderer(T, cv);
  } catch {
    return undefined;
  }
  const { r0: R0, width: RW, gap: GAP, height: HH, level: GAPY } = RING;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(32, 1, 0.1, 300);
  const lights = makeLights(T, scene);
  const mats: Materials = makeMaterials(T);
  const strata = makeStrata(T, geometryFor(T, S), mats);
  scene.add(strata.root);

  let matKey = "";
  const stopPalette = watchScopedPalette(o.root, (palette) => {
    paintMaterials(T, mats, palette);
    lights(palette.scheme === "dark");
    matKey = "";
  });

  const resize = (): void => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w < 1 || h < 1) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : undefined;
  ro?.observe(stage);
  resize();
  const governor = makeGovernor(renderer, resize);
  const placeTag = makeTagWriter();
  // Input and control changes run at the display's rate; the slow turn on its own is drawn at half of it.
  let busyUntil = 0;
  const wake = (ms = 1500): void => {
    busyUntil = performance.now() + ms;
  };

  let reduce = prefersReducedMotion();
  const motionQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : undefined;
  const onMotion = (): void => {
    reduce = prefersReducedMotion();
  };
  motionQuery?.addEventListener("change", onMotion);

  const st = { spread: 1, spreadShown: 1, level: 0, el: 0.6, elT: 0.6, zoom: 1, zoomShown: 1, yaw: 0.6, sel: -1 };
  let hovered: THREE.Mesh | null = null;
  let dragging: { x: number; y: number; yaw: number; el: number; moved: number } | null = null;
  let px = -1;
  let py = -1;
  let mx = 0;
  let my = 0;
  let branch: Set<number> | null = null;
  let inView = false;

  const read = (u: PickData | null): void => {
    const k = u && !isCore(u) ? u.k : u && isCore(u) ? -1 : st.sel;
    o.onRead(readoutFor(figures, S, k, k >= 0 && k === st.sel, branch ? branch.size : 0));
  };
  const select = (k: number): void => {
    wake();
    st.sel = k;
    branch = k < 0 ? null : branchOf(S, k);
    matKey = "";
    read(hovered ? (hovered.userData as PickData) : null);
  };

  const ray = new T.Raycaster();
  const ndc = new T.Vector2();
  const pickables: THREE.Mesh[] = [...strata.pieces, strata.core];
  const pick = (): THREE.Mesh | null => {
    ndc.set(mx, my);
    ray.setFromCamera(ndc, camera);
    const hs = ray.intersectObjects(pickables, false).filter((h) => h.object.visible);
    return hs.length ? (hs[0]!.object as THREE.Mesh) : null;
  };
  const onDown = (e: PointerEvent): void => {
    wake();
    dragging = { x: e.clientX, y: e.clientY, yaw: st.yaw, el: st.el, moved: 0 };
    cv.setPointerCapture(e.pointerId);
    cv.style.cursor = "grabbing";
  };
  const onMove = (e: PointerEvent): void => {
    const r = cv.getBoundingClientRect();
    px = e.clientX - r.left;
    py = e.clientY - r.top;
    mx = (px / r.width) * 2 - 1;
    my = -(py / r.height) * 2 + 1;
    wake();
    if (dragging) {
      const dx = e.clientX - dragging.x;
      const dy = e.clientY - dragging.y;
      dragging.moved = Math.max(dragging.moved, Math.hypot(dx, dy));
      st.yaw = dragging.yaw + dx * 0.006;
      st.el = st.elT = clamp(dragging.el + dy * 0.005, EL_MIN, EL_MAX);
    }
  };
  const onUp = (): void => {
    if (dragging && dragging.moved < 5) {
      const hit = pick();
      select(hit && !isCore(hit.userData as PickData) ? (hit.userData as { k: number }).k : -1);
    }
    if (dragging && dragging.moved >= 5) o.onFreeView();
    dragging = null;
    cv.style.cursor = "grab";
  };
  const onLeave = (): void => {
    px = py = -1;
  };
  const zoomBy = (factor: number): void => {
    wake();
    st.zoom = clamp(st.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  };
  const onKey = (e: KeyboardEvent): void => {
    wake();
    const k = e.key;
    let used = true;
    if (k === "ArrowLeft") st.yaw -= 0.15;
    else if (k === "ArrowRight") st.yaw += 0.15;
    else if (k === "ArrowUp") {
      st.elT = clamp(st.elT + 0.12, EL_MIN, EL_MAX);
      o.onFreeView();
    } else if (k === "ArrowDown") {
      st.elT = clamp(st.elT - 0.12, EL_MIN, EL_MAX);
      o.onFreeView();
    } else if (k === "+" || k === "=") zoomBy(0.85);
    else if (k === "-") zoomBy(1 / 0.85);
    else if (k === "Escape") select(-1);
    else used = false;
    if (used) e.preventDefault();
  };
  cv.addEventListener("pointerdown", onDown);
  cv.addEventListener("pointermove", onMove);
  cv.addEventListener("pointerup", onUp);
  cv.addEventListener("pointerleave", onLeave);
  cv.addEventListener("keydown", onKey);

  const v3 = new T.Vector3();
  let prev = 0;
  let lastDraw = 0;
  let lastPick = 0;
  let lastSpread = -1;
  const ringY = (r: number, sp: number): number => (4 - r) * (HH * 0.5 + (GAPY - HH * 0.5) * sp);
  let raf = 0;
  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    if (!inView) {
      prev = now;
      return;
    }
    if (hovered !== null || Math.abs(st.spread - st.spreadShown) > 1e-3 || Math.abs(st.zoom - st.zoomShown) > 1e-3 || Math.abs(st.elT - st.el) > 1e-3) wake();
    if (now >= busyUntil && now - lastDraw < 30) return;
    const dt = Math.min(64, now - (prev || now));
    prev = now;
    lastDraw = now;
    const e = reduce ? 1 : 0.1;
    st.spreadShown += (st.spread - st.spreadShown) * e;
    st.zoomShown += (st.zoom - st.zoomShown) * e;
    if (!dragging) st.el += (st.elT - st.el) * e;
    if (!dragging && !reduce && !hovered && st.sel < 0) st.yaw += (0.0012 * dt) / 16.67;
    const sp = st.spreadShown;
    ([1, 2, 3, 4] as const).forEach((r) => {
      strata.rings[r].position.y = ringY(r, sp);
    });
    strata.core.position.y = 4 * (HH * 0.5 + (GAPY - HH * 0.5) * sp);
    const dist = Math.max(24, 23 / Math.max(0.35, camera.aspect)) * st.zoomShown;
    const lookY = 2.3 * sp + 0.3;
    camera.position.set(Math.sin(st.yaw) * Math.cos(st.el) * dist, Math.sin(st.el) * dist + lookY, Math.cos(st.yaw) * Math.cos(st.el) * dist);
    camera.lookAt(0, lookY, 0);

    // Picking tests every triangle of the extruded rings, so it runs at 15 Hz and keeps the last answer in between.
    let hit: THREE.Mesh | null = null;
    if (px >= 0 && !dragging) {
      hit = hovered;
      if (now - lastPick >= 66) {
        lastPick = now;
        hit = pick();
      }
    }
    if (hit !== hovered) {
      hovered = hit;
      matKey = "";
      read(hovered ? (hovered.userData as PickData) : null);
    }

    // Materials: in focus, dimmed, hovered or selected.
    const key = `${st.level}/${st.sel}/${hovered ? hovered.id : 0}`;
    // The light never moves, so shadows are redrawn only when a ring moved or one stopped or started casting.
    if (key !== matKey || sp !== lastSpread) {
      lastSpread = sp;
      renderer.shadowMap.needsUpdate = true;
    }
    if (key !== matKey) {
      matKey = key;
      strata.pieces.forEach((m) => {
        const u = m.userData as { k: number; ring: number; kind: number };
        const focus = (st.level === 0 || u.ring === st.level) && (!branch || branch.has(u.k));
        m.material = m === hovered ? mats.hot : u.k === st.sel ? mats.sel : focus ? mats.base[u.kind]! : mats.dim[u.kind]!;
        m.castShadow = focus;
      });
      strata.core.material = st.level === 0 ? mats.core : mats.coreDim;
    }
    if (hovered) {
      const r = cv.getBoundingClientRect();
      o.tip.show(TIP_OWNER, hoverText(hovered.userData as PickData, figures.repository, figures.counts.files, KIND_WORDS, number), r.left + px, r.top + py);
      cv.style.cursor = "pointer";
    } else {
      o.tip.hide(TIP_OWNER);
      if (!dragging) cv.style.cursor = "grab";
    }

    const W = stage.clientWidth;
    const Hh = stage.clientHeight;
    o.tags.forEach((t, k) => {
      if (k === 0) v3.set(0, strata.core.position.y + HH * 2.9, 0);
      else {
        const rr = R0 + (k - 1) * (RW + GAP) + RW;
        v3.set(rr * 0.72, strata.rings[k as 1 | 2 | 3 | 4].position.y + HH * 1.3, rr * 0.72);
      }
      v3.project(camera);
      const on = st.level === 0 ? k === 0 || sp > 0.45 : k === st.level;
      placeTag(t, ((v3.x + 1) / 2) * W, ((1 - v3.y) / 2) * Hh, on ? 1 : 0);
    });
    renderer.render(scene, camera);
    governor(now);
  };
  raf = requestAnimationFrame(frame);

  const handle: ExplorerHandle = {
    setSpread: (spread) => {
      st.spread = clamp(spread, 0, 1);
    },
    setLevel: (level) => {
      st.level = level;
    },
    setElevation: (elevation) => {
      st.elT = clamp(elevation, EL_MIN, EL_MAX);
    },
    zoomBy,
    reset: () => {
      Object.assign(st, { spread: 1, level: 0, elT: 0.6, zoom: 1, yaw: 0.6 });
      select(-1);
    },
    setInView: (value) => {
      inView = value;
      if (value) wake();
    },
  };
  read(null);

  const stop = (): void => {
    cancelAnimationFrame(raf);
    stopPalette();
    ro?.disconnect();
    motionQuery?.removeEventListener("change", onMotion);
    cv.removeEventListener("pointerdown", onDown);
    cv.removeEventListener("pointermove", onMove);
    cv.removeEventListener("pointerup", onUp);
    cv.removeEventListener("pointerleave", onLeave);
    cv.removeEventListener("keydown", onKey);
    o.tip.hide(TIP_OWNER);
    [...mats.base, ...mats.dim, mats.core, mats.coreDim, mats.hot, mats.sel].forEach((m) => m.dispose());
    renderer.dispose();
  };
  return { handle, stop };
}
