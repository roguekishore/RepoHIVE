"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { repoNavItems } from "@/components/layout/nav-items";

/** Dashboard / owner/repo / current view, above every repository page. */
export function RepoBreadcrumb({ repoId }: { repoId: string }) {
  const pathname = usePathname();
  const current = repoNavItems(repoId).find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  if (current === undefined) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-2 text-sm sm:px-6"
    >
      <Link href="/" className="text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]">
        Dashboard
      </Link>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-tertiary)]" />
      <span className="truncate text-[var(--color-text-secondary)]">{repoId}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-tertiary)]" />
      <span className="truncate font-medium text-[var(--color-text-primary)]">{current.label}</span>
    </nav>
  );
}
