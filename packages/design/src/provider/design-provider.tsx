"use client";

import { createContext, useContext, useMemo, type AnchorHTMLAttributes, type ComponentType, type ReactNode } from "react";
import type { ContractClient } from "../contracts";
import { ThemeProvider, type ThemeStorage } from "../theme/theme";
import { ToastProvider } from "./toast";

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  readonly href: string;
}

/** A link component the host supplies, so client-side navigation belongs to the host's router and not to this package. */
export type LinkComponent = ComponentType<LinkProps>;

function PlainLink({ href, ...rest }: LinkProps) {
  return <a href={href} {...rest} />;
}

interface DesignContextValue {
  readonly Link: LinkComponent;
  readonly navigate: (href: string) => void;
  readonly client: ContractClient | undefined;
}

const DesignContext = createContext<DesignContextValue | undefined>(undefined);

export interface DesignProviderProps {
  readonly children: ReactNode;
  /** The host's link component. Defaults to a plain anchor, which navigates with a full page load. */
  readonly Link?: LinkComponent;
  /** Moves to a path from code (the search palette uses it). Defaults to a full page load. */
  readonly navigate?: (href: string) => void;
  /** The client screens use for actions and lazy reads. Components that need it throw a clear error when it is absent. */
  readonly client?: ContractClient;
  readonly themeStorage?: ThemeStorage;
}

function pageNavigate(href: string): void {
  window.location.assign(href);
}

/**
 * The root of everything this package draws. It holds what a host injects (link, navigation, client), the theme and the
 * toast, and it wraps the page in `.rh-root`, which carries the base type and colour. Mount it once, high.
 */
export function DesignProvider({ children, Link = PlainLink, navigate = pageNavigate, client, themeStorage }: DesignProviderProps) {
  const value = useMemo<DesignContextValue>(() => ({ Link, navigate, client }), [Link, navigate, client]);
  return (
    <DesignContext.Provider value={value}>
      <ThemeProvider storage={themeStorage}>
        <ToastProvider>
          <div className="rh-root">{children}</div>
        </ToastProvider>
      </ThemeProvider>
    </DesignContext.Provider>
  );
}

function useDesign(): DesignContextValue {
  const value = useContext(DesignContext);
  if (value === undefined) throw new Error("This component must be used inside a DesignProvider");
  return value;
}

export function useLink(): LinkComponent {
  return useDesign().Link;
}

export function useNavigate(): (href: string) => void {
  return useDesign().navigate;
}

/** The injected contract client. Throws if the host mounted the provider without one. */
export function useClient(): ContractClient {
  const { client } = useDesign();
  if (client === undefined) throw new Error("DesignProvider was mounted without a client");
  return client;
}
