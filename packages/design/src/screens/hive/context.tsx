"use client";

import { createContext, useContext, type RefObject } from "react";
import type { LandingFigures } from "../landing/figures-types";
import type { HiveModel, Strata } from "./model";

/** The hover tooltip both 3D scenes share: whoever showed it is the only one that may hide it. */
export interface TipApi {
  show(owner: string, text: readonly [before: string, bold: string, after: string], clientX: number, clientY: number): void;
  hide(owner: string): void;
}

export interface HiveContextValue {
  readonly figures: LandingFigures;
  readonly model: HiveModel;
  readonly strata: Strata;
  /** The `.rh-hv` element: the palette is read from it. */
  readonly root: RefObject<HTMLDivElement | null>;
  readonly tip: TipApi;
  /** Opens the real index-request dialog for `owner/repo`. The dialog lives at the page root, outside any transformed ancestor. */
  readonly requestIndex: (repo: string) => void;
}

export const HiveContext = createContext<HiveContextValue | undefined>(undefined);

export function useHive(): HiveContextValue {
  const value = useContext(HiveContext);
  if (value === undefined) throw new Error("hive: this component must be rendered inside HiveLanding");
  return value;
}
