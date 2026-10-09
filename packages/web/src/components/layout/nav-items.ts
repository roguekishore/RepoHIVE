import { Boxes, ClipboardList, GitCompare, LayoutDashboard, Network, ScanSearch } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

/** Account actions (sign in, sign up, quota, sign out) live in the sidebar footer, not here. */
export const GLOBAL_NAV: NavItem[] = [{ label: "Dashboard", href: "/", icon: LayoutDashboard, exact: true }];

/** The six views of one indexed repository. */
export function repoNavItems(repoId: string): NavItem[] {
  const base = `/repos/${repoId}`;
  return [
    { label: "Structure map", href: `${base}/knowledge-graph`, icon: ScanSearch },
    { label: "Hierarchy", href: `${base}/hierarchy`, icon: Network },
    { label: "Decisions", href: `${base}/decision-audit`, icon: ClipboardList },
    { label: "Architecture", href: `${base}/architecture`, icon: Boxes },
    { label: "Flat baseline", href: `${base}/flat-baseline`, icon: Network },
    { label: "Adaptivity", href: `${base}/adaptivity`, icon: GitCompare },
  ];
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
