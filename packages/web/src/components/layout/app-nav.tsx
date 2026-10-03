"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/cn";
import { repoIdFromPathname } from "@/features/repository/repo-name";
import { BrandLogo } from "@/components/shared/brand-logo";
import { AccountPanel } from "@/features/account/account-panel";
import { GLOBAL_NAV, isNavItemActive, repoNavItems, type NavItem } from "./nav-items";

function NavLink({ item, pathname, small }: { item: NavItem; pathname: string; small?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2 transition-colors",
        small ? "py-1.5 text-[13px]" : "py-2 text-sm",
        isNavItemActive(item, pathname)
          ? "bg-[var(--color-bg-elevated)] font-medium text-[var(--color-text-primary)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]",
      )}
    >
      <Icon
        className={cn(
          "shrink-0",
          small ? "h-4 w-4" : "h-[18px] w-[18px]",
          isNavItemActive(item, pathname) && "text-[var(--color-accent-primary)]",
        )}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

/** The global links, then the six views of the repository named in the URL. */
function NavList({ pathname }: { pathname: string }) {
  const repoId = repoIdFromPathname(pathname);
  return (
    <div className="space-y-4 px-3 py-3">
      <nav className="space-y-1">
        {GLOBAL_NAV.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
      {repoId !== undefined && (
        <nav aria-label={repoId} className="space-y-0.5 border-t border-[var(--color-border-default)] pt-4">
          <p className="px-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
            Repository
          </p>
          <p className="mb-2 flex items-center gap-2 truncate px-2 text-sm font-medium text-[var(--color-text-primary)]">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent-fill)]" />
            <span className="truncate">{repoId}</span>
          </p>
          {repoNavItems(repoId).map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} small />
          ))}
        </nav>
      )}
    </div>
  );
}

/** Theme toggle, then the account block beneath it. */
function SidebarFooter() {
  return (
    <div className="space-y-3 border-t border-[var(--color-border-default)] px-4 py-3">
      <ThemeToggle className="w-full justify-between" />
      <AccountPanel />
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden h-full w-[260px] shrink-0 flex-col border-r border-[var(--color-border-default)] bg-[var(--color-bg-surface)] md:flex">
      <div className="flex h-14 items-center gap-3 px-4">
        <BrandLogo size={28} />
        <span className="truncate text-base font-semibold tracking-tight text-[var(--color-text-primary)]">RepoHIVE</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <NavList pathname={pathname} />
      </div>
      <SidebarFooter />
    </aside>
  );
}

export function MobileNav() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 md:hidden">
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open navigation menu" className="h-11 w-11">
        <Menu className="h-5 w-5" />
      </Button>
      <BrandLogo size={24} />
      <span className="truncate text-base font-semibold tracking-tight text-[var(--color-text-primary)]">RepoHIVE</span>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="h-14 flex-row items-center gap-3 border-b border-[var(--color-border-default)] px-4 py-0">
            <BrandLogo size={28} />
            <SheetTitle className="text-base">RepoHIVE</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            <NavList pathname={pathname} />
          </div>
          <SidebarFooter />
        </SheetContent>
      </Sheet>
    </div>
  );
}
