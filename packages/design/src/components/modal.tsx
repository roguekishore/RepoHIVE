"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../icons/icons";
import { Button } from "./button";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** The buttons at the foot, right-aligned. */
  readonly footer?: ReactNode;
}

/**
 * A dialog over a scrim. On open, focus moves to the first field (or the primary button); Tab stays inside; Escape and a
 * click on the scrim close it; on close, focus returns to what had it before.
 */
export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialog.current;
    const first = node?.querySelector<HTMLElement>("input, .rh-modal-foot .rh-btn-primary") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="rh-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={dialog} className="rh-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <div className="rh-modal-head">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" size="sm" icon aria-label="Close" onClick={onClose}>
            <Icon name="x" size={12} />
          </Button>
        </div>
        <div className="rh-modal-body">{children}</div>
        {footer === undefined ? null : <div className="rh-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
