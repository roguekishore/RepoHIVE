"use client";

import type { ButtonHTMLAttributes, Ref } from "react";
import { useLink, type LinkProps } from "../provider/design-provider";
import { cx } from "./cx";

export type ButtonVariant = "default" | "primary" | "ghost";
export type ButtonSize = "md" | "sm" | "lg";

interface ButtonStyle {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** A square button that holds only an icon; give it an `aria-label`. */
  readonly icon?: boolean;
}

function buttonClass({ variant = "default", size = "md", icon = false }: ButtonStyle, extra?: string): string {
  return cx(
    "rh-btn",
    variant === "primary" && "rh-btn-primary",
    variant === "ghost" && "rh-btn-ghost",
    size === "sm" && "rh-btn-sm",
    size === "lg" && "rh-btn-lg",
    icon && "rh-btn-icon",
    extra,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyle {
  readonly ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant, size, icon, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass({ variant, size, icon }, className)} {...rest} />;
}

export interface LinkButtonProps extends LinkProps, ButtonStyle {}

/** A link that looks like a button. It goes through the host's link component. */
export function LinkButton({ variant, size, icon, className, ...rest }: LinkButtonProps) {
  const Link = useLink();
  return <Link className={buttonClass({ variant, size, icon }, className)} {...rest} />;
}
