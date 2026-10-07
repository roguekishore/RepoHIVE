"use client";

import type { ReactNode } from "react";
import { Button } from "../components/button";
import { cx } from "../components/cx";
import { Icon } from "../icons/icons";

export interface WorkspaceProps {
  /** The stage: a canvas or an SVG. It fills the space the inspector leaves. */
  readonly children: ReactNode;
  /** The inspector, 212px wide. Pass it only while something is selected; it is absent otherwise. */
  readonly inspector?: ReactNode;
}

/** The layout of a canvas view: the stage, and beside it (below it on a narrow screen) the inspector when there is one. */
export function Workspace({ children, inspector }: WorkspaceProps) {
  return (
    <div className={cx("rh-view", inspector !== undefined && "rh-has-insp")}>
      <div className="rh-stage">{children}</div>
      {inspector}
    </div>
  );
}

export interface InspectorProps {
  readonly title: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** The side panel for the selected thing. */
export function Inspector({ title, onClose, children }: InspectorProps) {
  return (
    <aside className="rh-insp" aria-label="Selection">
      <div className="rh-insp-head">
        <h4>{title}</h4>
        <Button variant="ghost" size="sm" icon aria-label="Clear selection" onClick={onClose}>
          <Icon name="x" size={12} />
        </Button>
      </div>
      {children}
    </aside>
  );
}

/** The 28px line at the foot of a view: the left side says what is under the pointer, the right side is for keys and state. */
export function StatusLine({ main, aside }: { readonly main: ReactNode; readonly aside?: ReactNode }) {
  return (
    <>
      <span className="rh-status-main">{main}</span>
      {aside === undefined ? null : <span className="rh-status-sp">{aside}</span>}
    </>
  );
}
