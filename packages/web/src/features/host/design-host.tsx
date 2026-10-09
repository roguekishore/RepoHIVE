"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, type ReactNode } from "react";
import { DesignProvider, type LinkProps } from "@repohive/design";
import { createBrowserClient } from "./browser-client";

/** The design package draws links through the host's router, so navigation stays client-side. */
function HostLink(props: LinkProps) {
  return <NextLink {...props} />;
}

/**
 * Mounts `@repohive/design` for a page: Next's link and router, and the TS translation layer's client. A route shell
 * wraps its screen in this, so a screen is given a client and never a URL.
 */
export function DesignHost({ children }: { children: ReactNode }) {
  const router = useRouter();
  const client = useMemo(() => createBrowserClient(), []);
  const navigate = useCallback((href: string) => router.push(href), [router]);
  return (
    <DesignProvider Link={HostLink} navigate={navigate} client={client}>
      {children}
    </DesignProvider>
  );
}
