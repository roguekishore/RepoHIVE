"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { Icon, type IconName } from "../icons/icons";
import { cx } from "./cx";
import { Kbd } from "./kbd";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  readonly ref?: Ref<HTMLInputElement>;
  /** A leading icon, for a search or filter box. */
  readonly icon?: IconName;
  /** A key hint at the trailing edge, such as `/`. */
  readonly hint?: string;
  readonly size?: "md" | "lg";
}

/** The compact input of a toolbar: an icon, the text, an optional key hint. It focuses as one control. */
export function Field({ icon, hint, size = "md", className, ...rest }: FieldProps) {
  return (
    <label className={cx("rh-field", size === "lg" && "rh-field-lg", className)}>
      {icon === undefined ? null : <Icon name={icon} size={14} />}
      <input {...rest} />
      {hint === undefined ? null : <Kbd>{hint}</Kbd>}
    </label>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly ref?: Ref<HTMLInputElement>;
  readonly invalid?: boolean;
}

/** The bordered input of a form. */
export function Input({ invalid = false, className, ...rest }: InputProps) {
  return <input className={cx("rh-input", className)} aria-invalid={invalid ? true : undefined} {...rest} />;
}

export interface LabeledInputProps extends Omit<InputProps, "id" | "invalid"> {
  readonly label: string;
  /** A message under the input. When `error` is set it is shown in the error colour and the input is marked invalid. */
  readonly hint?: ReactNode;
  readonly error?: string;
}

/** A form input with its label and its hint or error message wired together for assistive technology. */
export function LabeledInput({ label, hint, error, ...rest }: LabeledInputProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="rh-form-field">
      <label className="rh-form-label" htmlFor={id}>
        {label}
      </label>
      <Input id={id} invalid={error !== undefined} aria-describedby={note === undefined ? undefined : noteId} {...rest} />
      {note === undefined ? null : (
        <p id={noteId} className={cx("rh-form-note", error !== undefined && "rh-form-error")}>
          {note}
        </p>
      )}
    </div>
  );
}
