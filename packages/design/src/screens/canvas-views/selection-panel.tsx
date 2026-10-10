import type { ReactNode } from "react";
import { Button } from "../../components/button";
import { Icon } from "../../icons/icons";

export interface SelectionPanelProps {
  /** The small mono label at the top left: what kind of thing is selected ("Level 3", "File"). */
  readonly kind: string;
  /** The selection's name, as the heading. */
  readonly title: ReactNode;
  readonly onClose: () => void;
  readonly children?: ReactNode;
}

/**
 * The inspector of a canvas view as the Screens artifact lays it out: the kind and the close button in a row, the name
 * under it, then the details. It is the 212px column the frame's `Workspace` reserves.
 */
export function SelectionPanel({ kind, title, onClose, children }: SelectionPanelProps) {
  return (
    <aside className="rh-insp" aria-label="Selection">
      <div className="rh-insp-head">
        <span className="rh-t-label">{kind}</span>
        <Button variant="ghost" size="sm" icon aria-label="Clear selection" onClick={onClose}>
          <Icon name="x" size={12} />
        </Button>
      </div>
      <h4>{title}</h4>
      {children}
    </aside>
  );
}
