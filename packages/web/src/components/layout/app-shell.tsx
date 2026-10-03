"use client";

import { usePathname } from "next/navigation";
import { MobileNav, Sidebar } from "./app-nav";

/**
 * The navigation frame around every page except the standalone auth pages
 * (`/auth/*`), which render alone, centred, with no sidebar.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/auth/")) {
    return (
      <main id="main-content" className="h-screen overflow-auto">
        {children}
      </main>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileNav />
        {/* A flex column, so anything a route layout stacks above the page
            (repo breadcrumb) is subtracted from the page's own height
            rather than added to it; a full-bleed canvas then keeps its
            bottom-anchored chrome inside the viewport. */}
        <main id="main-content" className="flex min-w-0 flex-1 flex-col overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
