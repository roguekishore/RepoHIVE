"use client";

import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cx } from "./cx";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> {
  readonly pressed: boolean;
  readonly children: ReactNode;
}

/** A toggle for a filter. `pressed` shows as a strong outline and a sunken ground. */
export function Chip({ pressed, className, type = "button", ...rest }: ChipProps) {
  return <button type={type} className={cx("rh-chip", className)} aria-pressed={pressed} {...rest} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Required: a select has no visible label in a toolbar. */
  readonly "aria-label": string;
}

/** The native select, in the toolbar size. The browser draws the list, so it works with a keyboard and a screen reader. */
export function Select({ className, ...rest }: SelectProps) {
  return <select className={cx("rh-select", className)} {...rest} />;
}

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  readonly label: string;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly className?: string;
}

/** A row of buttons of which one is on. Each is a toggle button, so it reads correctly without a radio group. */
export function SegmentedControl<T extends string>({ label, options, value, onChange, className }: SegmentedControlProps<T>) {
  return (
    <div className={cx("rh-seg", className)} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
