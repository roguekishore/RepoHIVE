"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../icons/icons";
import { Kbd } from "../components/kbd";
import { useNavigate } from "../provider/design-provider";

export interface PaletteItem {
  readonly id: string;
  readonly label: string;
  /** Secondary text at the trailing edge, such as the repository a view belongs to. */
  readonly meta?: string;
  readonly icon: IconName;
  /** A path to go to, through the host's navigation. */
  readonly href?: string;
  /** Runs instead of navigating, for an item that does something. */
  readonly onSelect?: () => void;
}

export interface PaletteGroup {
  readonly label: string;
  readonly items: readonly PaletteItem[];
}

export interface SearchPaletteProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The groups for a query. Called on every keystroke, so keep it cheap; an empty query is the initial list. */
  readonly groups: (query: string) => readonly PaletteGroup[];
  readonly placeholder?: string;
  /** A line of context at the foot, hidden on a narrow screen. */
  readonly footnote?: string;
}

/** The ⌘K palette: one search box over a list of views, repositories, regions and files the host provides. */
export function SearchPalette({ open, onClose, groups, placeholder = "Search", footnote }: SearchPaletteProps) {
  const navigate = useNavigate();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    setIndex(0);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => previous?.focus();
  }, [open]);

  const shown = useMemo(() => (open ? groups(query).filter((group) => group.items.length > 0) : []), [open, groups, query]);
  const flat = useMemo(() => shown.flatMap((group) => group.items), [shown]);
  const active = Math.min(index, Math.max(0, flat.length - 1));

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  if (!open) return null;

  const choose = (position: number): void => {
    const item = flat[position];
    if (item === undefined) return;
    onClose();
    if (item.onSelect !== undefined) item.onSelect();
    else if (item.href !== undefined) navigate(item.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex(Math.min(flat.length - 1, active + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex(Math.max(0, active - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  let position = -1;
  return (
    <div
      className="rh-scrim rh-scrim-palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="rh-palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="rh-palette-input">
          <Icon name="search" size={18} />
          <input
            ref={input}
            value={query}
            placeholder={placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={flat.length === 0 ? undefined : `${listId}-${active}`}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="rh-palette-list" id={listId} role="listbox" aria-label="Results">
          {flat.length === 0 ? (
            <div className="rh-empty">
              <span>{query === "" ? "Nothing to show." : `Nothing matches "${query}".`}</span>
            </div>
          ) : (
            shown.map((group) => (
              <div key={group.label} role="group" aria-label={group.label}>
                <div className="rh-palette-group rh-t-label">{group.label}</div>
                {group.items.map((item) => {
                  position += 1;
                  const mine = position;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      id={`${listId}-${mine}`}
                      role="option"
                      className="rh-palette-item"
                      aria-selected={mine === active}
                      tabIndex={-1}
                      onClick={() => choose(mine)}
                      onMouseMove={() => {
                        if (mine !== active) setIndex(mine);
                      }}
                    >
                      <Icon name={item.icon} />
                      <span className="rh-palette-name">{item.label}</span>
                      {item.meta === undefined ? null : <span className="rh-palette-meta">{item.meta}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="rh-palette-foot">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>Enter</Kbd> open
          </span>
          {footnote === undefined ? null : <span className="rh-hide-sm">{footnote}</span>}
        </div>
      </div>
    </div>
  );
}
