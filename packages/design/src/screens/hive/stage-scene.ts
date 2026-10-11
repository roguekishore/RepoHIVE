/**
 * The pinned animation, as a scene. Scroll sets `control.prog` (0 to 1); this eases toward it and draws:
 * tangle, settle into a honeycomb, decide (kept regions stand up in ink, rebuilt ones stay low in violet), split into
 * one floating plate per level, then turn the plates into the extruded rings of the hierarchy.
 *
 * Ported from the approved Hive Core artifact, keeping its timings. The component owns the DOM and the scroll; this
 * owns the GPU. It returns a stop function, or `undefined` when WebGL is unavailable.
 */
import type * as THREE from "three";
import { mixColors, type CanvasPalette } from "../../canvas/colors";
import type { LandingFigures } from "../landing/figures-types";
import type { TipApi } from "./context";
import { clamp, KIND_WORDS, lerp, number, pieceHeight, RING, sm, type HiveModel, type Strata } from "./model";
import { prefersReducedMotion, watchScopedPalette } from "./palette";
import {
  geometryFor,
  hoverText,
  isCore,
  linear,
  makeGovernor,
  makeLights,
  makeMaterials,
  makeRenderer,
  makeStrata,
  makeTagWriter,
  paintMaterials,
  paletteColours,
  type PickData,
  type Strata3D,
  type Three,
} from "./scene";

/** What the scroll listener hands the scene each frame. */
export interface StageControl {
  /** Scroll progress through the pinned section, 0 to 1. */
  prog: number;
  inView: boolean;
  /** The current phase, 0 to 4. */
  cur: number;
}

export interface StageSceneOptions {
  readonly T: Three;
  readonly figures: LandingFigures;
  readonly model: HiveModel;
  readonly strata: Strata;
  readonly control: StageControl;
  readonly canvas: HTMLCanvasElement;
  readonly pin: HTMLElement;
  readonly plateTags: readonly HTMLElement[];
  readonly ringTags: readonly HTMLElement[];
  /** The `.rh-hv` element, for reading the palette. */
  readonly root: HTMLElement;
  readonly tip: TipApi;
}

const TIP_OWNER = "stage";

export function startStageScene(o: StageSceneOptions): (() => void) | undefined {
  const { T, figures, model: M, strata: S, control: ctl, canvas: cv, pin } = o;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = makeRenderer(T, cv);
  } catch {
    return undefined;
  }
  const { r0: R0, width: RW, gap: GAP, height: HH, level: GAPY } = RING;
  const N = M.n;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(32, 1, 0.1, 300);
  const lights = makeLights(T, scene);
  const root = new T.Group();
  scene.add(root);

  const U = 5.6;
  const CELL = M.hexS * U * 0.9;
  const DOT = 0.05;
  const hexGeo = new T.CylinderGeometry(1, 1, 1, 6);
  hexGeo.translate(0, 0.5, 0);
  // plate 0: files; 1: regions; 2: level-2 groups; 3: level-1 groups. Plate p becomes ring 4 - p.
  // Only the base plate takes part in shadows: the upper plates float clear of it, and a shadow pass or lookup over
  // three more sheets of N cells each costs a lot for a shadow nobody reads.
  const plates = [0, 1, 2, 3].map((p) => {
    const mat = new T.MeshStandardMaterial({ roughness: 0.82, metalness: 0, transparent: p > 0 });
    const mesh = new T.InstancedMesh(hexGeo, mat, N);
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.castShadow = p === 0;
    mesh.receiveShadow = p === 0;
    mesh.frustumCulled = false;
    root.add(mesh);
    return mesh;
  });
  const mats = makeMaterials(T);
  // The rings are only needed once the plates split, and building their geometry is the heaviest start-up step, so it
  // waits for an idle moment after the first frames (or for the scroll to need it, whichever comes first).
  let strata: Strata3D | undefined;
  let pickables: THREE.Object3D[] = [];
  const ensureStrata = (): Strata3D => {
    if (strata === undefined) {
      strata = makeStrata(T, geometryFor(T, S), mats);
      root.add(strata.root);
      pickables = [...strata.pieces, strata.core];
      renderer.shadowMap.needsUpdate = true;
    }
    return strata;
  };
  const idle = window.requestIdleCallback;
  const idleHandle = typeof idle === "function" ? idle.call(window, () => void ensureStrata(), { timeout: 2500 }) : window.setTimeout(() => void ensureStrata(), 1200);

  const links = figures.flat.links;
  const linkPos = new Float32Array(links.length * 3);
  const linkGeo = new T.BufferGeometry();
  linkGeo.setAttribute("position", new T.BufferAttribute(linkPos, 3));
  const linkMat = new T.LineBasicMaterial({ transparent: true, depthWrite: false });
  const lines = new T.LineSegments(linkGeo, linkMat);
  lines.frustumCulled = false;
  root.add(lines);

  // Where each plate's cell lands on its ring: the file's sweep, inside the ring's band.
  const land = [0, 1, 2, 3].map((p) => {
    const ring = 4 - p;
    const tx = new Float32Array(N);
    const tz = new Float32Array(N);
    const top = new Float32Array(N);
    const cov = new Uint8Array(N);
    for (let f = 0; f < N; f++) {
      const k = S.arcAt(ring, M.frac[f]!);
      cov[f] = k >= 0 && S.drawn[k] ? 1 : 0;
      const rr = R0 + (ring - 1) * (RW + GAP) + (0.15 + 0.7 * M.jit[f]!) * RW;
      const ang = Math.PI / 2 - M.frac[f]! * Math.PI * 2;
      tx[f] = Math.cos(ang) * rr;
      tz[f] = -Math.sin(ang) * rr;
      top[f] = cov[f] ? pieceHeight(S.arcs[k]![4]) + 0.03 : 0;
    }
    return { tx, tz, top, cov };
  });

  // Group order, so neighbouring groups take different neutrals.
  const rank = new Map<number, number>();
  {
    const seen = [0, 0];
    for (let f = 0; f < N; f++) {
      [M.anc1[f]!, M.anc2[f]!].forEach((node, j) => {
        if (!rank.has(node)) rank.set(node, seen[j]!++);
      });
    }
  }
  const pillar = new Float32Array(N);
  for (let f = 0; f < N; f++) {
    const k = M.kindOf[f]!;
    pillar[f] = k === 1 ? 1.25 + M.tint[f]! * 0.7 : k === 2 ? 0.26 + (M.subOf[f]! % 3) * 0.06 : 0.07;
  }

  interface Colours {
    neutral: Float32Array;
    decide: Float32Array;
    files: Float32Array;
    l2: Float32Array;
    l1: Float32Array;
  }
  let CS: Colours | undefined;
  let lastCol = "";
  let lastS = -1;
  const readColours = (palette: CanvasPalette): void => {
    const P = paletteColours(palette);
    const mix = mixColors;
    const NS = [mix(P.ls, P.bg, 0.25), P.ls, mix(P.ls, P.fg, 0.28), mix(P.ls, P.fg, 0.52)];
    const next: Colours = { neutral: new Float32Array(N * 3), decide: new Float32Array(N * 3), files: new Float32Array(N * 3), l2: new Float32Array(N * 3), l1: new Float32Array(N * 3) };
    const put = (arr: Float32Array, f: number, c: Parameters<typeof linear>[1]): void => {
      const l = linear(T, c);
      arr[f * 3] = l.r;
      arr[f * 3 + 1] = l.g;
      arr[f * 3 + 2] = l.b;
    };
    for (let f = 0; f < N; f++) {
      const k = M.kindOf[f]!;
      const t = M.tint[f]! * 0.3;
      put(next.neutral, f, P.fg2);
      put(next.decide, f, k === 1 ? mix(P.fg, P.bg, t * 0.6) : k === 2 ? mix(P.acc, P.bg, t) : P.ls);
      put(next.files, f, k === 2 ? mix(P.acc, P.bg, (M.subOf[f]! % 3) * 0.24) : k === 1 ? mix(P.fg, P.bg, t * 0.6) : P.line);
      put(next.l2, f, NS[rank.get(M.anc2[f]!)! % 4]!);
      put(next.l1, f, NS[1 + 2 * (rank.get(M.anc1[f]!)! % 2)]!);
    }
    const setAll = (mesh: THREE.InstancedMesh, arr: Float32Array): void => {
      const c = new T.Color();
      for (let f = 0; f < N; f++) {
        c.setRGB(arr[f * 3]!, arr[f * 3 + 1]!, arr[f * 3 + 2]!);
        mesh.setColorAt(f, c);
      }
      mesh.instanceColor!.needsUpdate = true;
    };
    setAll(plates[1]!, next.decide);
    setAll(plates[2]!, next.l2);
    setAll(plates[3]!, next.l1);
    linkMat.color = linear(T, P.fg3);
    paintMaterials(T, mats, palette);
    lights(palette.scheme === "dark");
    CS = next;
    lastCol = "";
    lastS = -1;
  };
  const stopPalette = watchScopedPalette(o.root, readColours);

  const plateTags = o.plateTags;
  const ringTags = o.ringTags;

  const resize = (): void => {
    const w = pin.clientWidth;
    const h = pin.clientHeight;
    if (w < 1 || h < 1) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // The copy sits in the bottom-left corner, so the picture is drawn up and to the right of centre (a shifted view
    // window, so the tags, which project through the same camera, follow it). On a narrow screen, up only.
    const right = w < 860 ? 0 : 0.09;
    camera.setViewOffset(w, h, -w * right, h * 0.06, w, h);
    camera.updateProjectionMatrix();
  };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : undefined;
  ro?.observe(pin);
  resize();
  const governor = makeGovernor(renderer, resize);
  const placeTag = makeTagWriter();

  let reduce = prefersReducedMotion();
  const motionQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : undefined;
  const onMotion = (): void => {
    reduce = prefersReducedMotion();
  };
  motionQuery?.addEventListener("change", onMotion);

  let yaw = 0.35;
  let dragging: { x: number; yaw: number } | null = null;
  let px = -1;
  let py = -1;
  let mx = 0;
  let my = 0;
  let hovered: THREE.Mesh | null = null;
  const onDown = (e: PointerEvent): void => {
    dragging = { x: e.clientX, yaw };
    cv.setPointerCapture(e.pointerId);
    cv.style.cursor = "grabbing";
  };
  const onMove = (e: PointerEvent): void => {
    const r = cv.getBoundingClientRect();
    px = e.clientX - r.left;
    py = e.clientY - r.top;
    mx = (px / r.width) * 2 - 1;
    my = -(py / r.height) * 2 + 1;
    if (dragging) yaw = dragging.yaw + (e.clientX - dragging.x) * 0.006;
  };
  const onUp = (): void => {
    dragging = null;
    cv.style.cursor = "grab";
  };
  const onLeave = (): void => {
    px = py = -1;
  };
  cv.addEventListener("pointerdown", onDown);
  cv.addEventListener("pointermove", onMove);
  cv.addEventListener("pointerup", onUp);
  cv.addEventListener("pointerleave", onLeave);

  const ray = new T.Raycaster();
  const ndc = new T.Vector2();
  const v3 = new T.Vector3();
  const pxz = new Float32Array(N * 2);
  const mtx = new T.Matrix4();
  const col = new T.Color();
  const K = { flat: M.flat, hive: M.hive };

  // Whether the upper plates' matrices are already the resting ones (before they start to move, they never change).
  const resting = [false, false, false, false];
  let shown = 0;
  let raf = 0;
  let prev = 0;
  let lastDraw = 0;
  let lastWob = 0;
  let lastPick = 0;
  let lastCur = ctl.cur;
  let busyUntil = 0;
  let sig = "";
  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    if (!ctl.inView || CS === undefined) {
      prev = now;
      return;
    }
    // Scroll, a drag, a hover or a phase change run at the display's rate; the slow turn of the picture alone does not
    // need more than half of it.
    if (dragging !== null || px >= 0 || Math.abs(ctl.prog - shown) > 1e-3 || lastCur !== ctl.cur) busyUntil = now + 1200;
    lastCur = ctl.cur;
    if (now >= busyUntil && now - lastDraw < 30) return;
    const dt = Math.min(64, now - (prev || now));
    prev = now;
    lastDraw = now;
    shown += (ctl.prog - shown) * (reduce ? 1 : 0.07);
    const s = shown * 4;
    const time = now / 1000;
    const sep = s < 2.3 ? 0 : s < 3 ? sm((s - 2.3) / 0.7) : 1;
    const settle = clamp(s, 0, 1);
    const rise = s < 1.15 ? 0 : s < 2 ? sm((s - 1.15) / 0.85) : 1 - sm((s - 2.1) / 0.6);
    const cm = sm((s - 1.1) / 0.6);
    const fs = sep;
    const grow = (r: number): number => sm((s - 3.35 - (4 - r) * 0.07) / 0.45);
    const sb = sm(s - 3);
    const wob = reduce ? 0 : (1 - Math.min(1, s * 1.4)) * 0.07;
    // The wobble is slow; refreshing every cell at 30 Hz reads the same and halves the work.
    const wobDue = wob > 0 && now - lastWob >= 33;
    if (wobDue) lastWob = now;
    const changed = Math.abs(s - lastS) > 1e-4 || wobDue;
    lastS = s;
    if (s > 2.3 && strata === undefined) ensureStrata();

    // Camera: top down, then lower for the pillars, side on for the plates, up again for the strata.
    const el = s < 1 ? lerp(1.52, 1.12, sm(s)) : s < 2 ? lerp(1.12, 0.62, sm(s - 1)) : s < 3 ? lerp(0.62, 0.2, sm(s - 2)) : lerp(0.2, 0.58, sb);
    if (!dragging && !reduce && s > 0.8) yaw += (0.0014 * dt) / 16.67;
    const dist = Math.max(27, 26 / Math.max(0.35, camera.aspect)) * (1 + 0.06 * sb);
    const lookY = sep * GAPY * 1.6 + 0.6 * sb;
    camera.position.set(Math.sin(yaw) * Math.cos(el) * dist, Math.sin(el) * dist + lookY, Math.cos(yaw) * Math.cos(el) * dist);
    camera.lookAt(0, lookY, 0);

    // The strata rise under the plates, each ring where its plate floats.
    const rings = strata;
    if (rings !== undefined) {
      ([1, 2, 3, 4] as const).forEach((r) => {
        const g = grow(r);
        const ring = rings.rings[r];
        ring.visible = g > 0.01;
        ring.scale.y = Math.max(0.01, g);
        ring.position.y = (4 - r) * GAPY * sep;
      });
      const cg = sm((s - 3.6) / 0.35);
      rings.core.visible = cg > 0.01;
      rings.core.scale.y = Math.max(0.01, cg);
      rings.core.position.y = 4 * GAPY * sep;
    }
    // The light never moves, so shadows are redrawn only when something that casts one did.
    const rootAt = `${root.position.x.toFixed(3)}|${root.position.z.toFixed(3)}`;
    if (changed || rootAt !== sig) {
      sig = rootAt;
      renderer.shadowMap.needsUpdate = true;
    }

    if (changed) {
      const base = plates[0]!;
      const gone = s > 3.97;
      plates.forEach((m) => {
        m.visible = !gone;
      });
      if (!gone) {
        for (let p = 0; p < 4; p++) {
          const m = plates[p]!;
          const Lp = land[p]!;
          const g = grow(4 - p);
          const py0 = p * GAPY * sep;
          m.position.y = py0;
          if (p > 0) {
            m.visible = sep > 0.01;
            const mat = m.material as THREE.MeshStandardMaterial;
            mat.opacity = sm(sep * 1.6);
            // Once fully opaque a plate needs no blending, which is the dearest part of drawing three sheets of cells.
            mat.transparent = mat.opacity < 0.999;
            if (!m.visible) continue;
            // Until the cells start to leave (s 3.05) a plate is the hive at rest: its matrices do not change, only
            // its height does, and that is the mesh's own position.
            const atRest = s <= 3.05;
            if (atRest && resting[p]) continue;
            resting[p] = atRest;
          }
          for (let f = 0; f < N; f++) {
            const d = M.delay[f]!;
            const mf = sm((s - 3.05 - d * 0.3) / 0.5);
            const fade = Lp.cov[f] ? sm((s - 3.62 - d * 0.1) / 0.25) : sm(mf * 1.6);
            let x: number;
            let z: number;
            let r: number;
            let h: number;
            if (p === 0) {
              const t = sm((settle - d * 0.35) / 0.65);
              x = lerp(K.flat[f * 2]!, K.hive[f * 2]!, t) * U;
              z = lerp(K.flat[f * 2 + 1]!, K.hive[f * 2 + 1]!, t) * U;
              if (wob) {
                x += Math.sin(time * 0.9 + M.phase[f]!) * wob;
                z += Math.cos(time * 0.7 + M.phase[f]! * 1.3) * wob;
              }
              r = lerp(DOT, CELL, t);
              h = lerp(0.04, 0.12, t) + (pillar[f]! - 0.12) * rise * Math.max(0, 1 - d * 0.3);
              pxz[f * 2] = x;
              pxz[f * 2 + 1] = z;
            } else {
              x = K.hive[f * 2]! * U;
              z = K.hive[f * 2 + 1]! * U;
              r = CELL;
              h = 0.1;
            }
            let y = 0;
            if (mf > 0) {
              x = lerp(x, Lp.tx[f]!, mf);
              z = lerp(z, Lp.tz[f]!, mf);
              y = Lp.top[f]! * g * mf + Math.sin(Math.PI * mf) * 0.45;
              r *= 1 - 0.4 * mf;
              h = lerp(h, 0.06, mf);
            }
            r *= 1 - fade;
            mtx.makeScale(Math.max(1e-4, r), Math.max(0.01, h), Math.max(1e-4, r));
            mtx.setPosition(x, y, z);
            m.setMatrixAt(f, mtx);
          }
          m.instanceMatrix.needsUpdate = true;
        }
        const key2 = `${cm.toFixed(3)}/${fs.toFixed(3)}`;
        if (key2 !== lastCol) {
          lastCol = key2;
          for (let f = 0; f < N; f++) {
            const i = f * 3;
            let r = lerp(CS.neutral[i]!, CS.decide[i]!, cm);
            let g = lerp(CS.neutral[i + 1]!, CS.decide[i + 1]!, cm);
            let b = lerp(CS.neutral[i + 2]!, CS.decide[i + 2]!, cm);
            r = lerp(r, CS.files[i]!, fs);
            g = lerp(g, CS.files[i + 1]!, fs);
            b = lerp(b, CS.files[i + 2]!, fs);
            col.setRGB(r, g, b);
            base.setColorAt(f, col);
          }
          base.instanceColor!.needsUpdate = true;
        }
      }
    }
    const la = 0.24 * (1 - sm(s / 0.7));
    lines.visible = la > 0.004;
    linkMat.opacity = la;
    if (lines.visible && changed) {
      for (let k = 0; k < links.length; k++) {
        const p = links[k]!;
        linkPos[k * 3] = pxz[p * 2]!;
        linkPos[k * 3 + 1] = 0.06;
        linkPos[k * 3 + 2] = pxz[p * 2 + 1]!;
      }
      linkGeo.attributes.position!.needsUpdate = true;
    }

    // Hover reads a piece once the strata stand.
    // Picking tests every triangle of the extruded rings, so it runs at 15 Hz and keeps the last answer in between.
    let hit: THREE.Mesh | null = null;
    if (px >= 0 && !dragging && s > 3.85) {
      hit = hovered;
      if (now - lastPick >= 66) {
        lastPick = now;
        hit = null;
        ndc.set(mx, my);
        ray.setFromCamera(ndc, camera);
        const hs = ray.intersectObjects(pickables, false);
        if (hs.length) hit = hs[0]!.object as THREE.Mesh;
      }
    }
    if (hit !== hovered) {
      const prev = hovered;
      if (prev && !isCore(prev.userData as PickData)) prev.material = mats.base[(prev.userData as { kind: number }).kind]!;
      hovered = hit;
      if (hovered && !isCore(hovered.userData as PickData)) hovered.material = mats.hot;
    }
    if (hovered) {
      const r = cv.getBoundingClientRect();
      o.tip.show(TIP_OWNER, hoverText(hovered.userData as PickData, figures.repository, figures.counts.files, KIND_WORDS, number), r.left + px, r.top + py);
      cv.style.cursor = "pointer";
    } else {
      o.tip.hide(TIP_OWNER);
      if (!dragging) cv.style.cursor = "grab";
    }

    // Labels: plate tags give way to the strata tags.
    const W = pin.clientWidth;
    const Hh = pin.clientHeight;
    const plateOp = (sep > 0.6 ? (sep - 0.6) / 0.4 : 0) * (1 - sm((s - 3.02) / 0.25));
    const ringOp = sm((s - 3.75) / 0.2);
    plateTags.forEach((t, p) => {
      v3.set(U * 1.02 * Math.cos(yaw), p * GAPY * sep + 0.1, -U * 1.02 * Math.sin(yaw)).add(root.position).project(camera);
      placeTag(t, ((v3.x + 1) / 2) * W + 12, ((1 - v3.y) / 2) * Hh, plateOp);
    });
    ringTags.forEach((t, k) => {
      if (rings === undefined) return;
      if (k === 0) v3.set(0, rings.core.position.y + HH * 2.9, 0);
      else {
        const rr = R0 + (k - 1) * (RW + GAP) + RW;
        v3.set(rr * 0.72, rings.rings[k as 1 | 2 | 3 | 4].position.y + HH * 1.3, rr * 0.72);
      }
      v3.add(root.position).project(camera);
      placeTag(t, ((v3.x + 1) / 2) * W, ((1 - v3.y) / 2) * Hh, ringOp);
    });
    renderer.render(scene, camera);
    governor(now);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    if (typeof idle === "function") window.cancelIdleCallback(idleHandle);
    else window.clearTimeout(idleHandle);
    stopPalette();
    ro?.disconnect();
    motionQuery?.removeEventListener("change", onMotion);
    cv.removeEventListener("pointerdown", onDown);
    cv.removeEventListener("pointermove", onMove);
    cv.removeEventListener("pointerup", onUp);
    cv.removeEventListener("pointerleave", onLeave);
    o.tip.hide(TIP_OWNER);
    plates.forEach((m) => {
      (m.material as THREE.Material).dispose();
      m.dispose();
    });
    hexGeo.dispose();
    linkGeo.dispose();
    linkMat.dispose();
    [...mats.base, ...mats.dim, mats.core, mats.coreDim, mats.hot, mats.sel].forEach((m) => m.dispose());
    renderer.dispose();
  };
}
