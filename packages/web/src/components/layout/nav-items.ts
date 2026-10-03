/**
 * Single source of truth for app navigation. Both the desktop sidebar and
 * the mobile nav consume these — the two surfaces must never diverge again.
 *
 * Repo IA: one group of the surfaces the index feeds (see `repoNavGroups`).
 */

import {
  Boxes,
  ClipboardList,
  Gauge,
  GitCompare,
  LayoutDashboard,
  LogIn,
  LogOut,
  Network,
  ScanSearch,
  Settings,
  UserPlus,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

interface NavGroup {
  /** Optional section label rendered above the items. */
  label?: string;
  items: NavItem[];
}

export const GLOBAL_NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, exact: true },
  { label: "Request index", href: "/request", icon: ClipboardList },
  { label: "Quota", href: "/quota", icon: Gauge },
  { label: "Sign in", href: "/auth/sign-in", icon: LogIn },
  { label: "Sign up", href: "/auth/sign-up", icon: UserPlus },
  { label: "Sign out", href: "/auth/sign-out", icon: LogOut },
  { label: "Settings", href: "/settings", icon: Settings },
];

/**
 * The gated repo navigation — the single declarative source of
 * Reachable_Surfaces (spec R9.1). Only surfaces RepoHIVE's engine genuinely
 * feeds are listed; everything else is not routed (R9.3/R9.6).
 *
 * Phase 1 (Reviews 2–3): Knowledge Graph only. To make another surface
 * reachable later, add its item here once its
 * data adapter exists (R9.5).
 */
export function repoNavGroups(repoId: string): NavGroup[] {
  const base = `/repos/${repoId}`;
  return [
    {
      items: [
        { label: "Structure map", href: `${base}/knowledge-graph`, icon: ScanSearch },
        // The same tree at full scale: depth as radius, decision as colour.
        { label: "Hierarchy", href: `${base}/hierarchy`, icon: Network },
        // The recorded per-region preserve/reconstruct record — the flagship
        // surface for the adaptive contribution (viewer handoff §9).
        { label: "Decisions", href: `${base}/decision-audit`, icon: ClipboardList },
        // The built hierarchy itself: level flow, group DSM, determinism.
        { label: "Architecture", href: `${base}/architecture`, icon: Boxes },
        { label: "Flat baseline", href: `${base}/flat-baseline`, icon: Network },
        // One snapshot's assessed preserve rate. The cross-repository comparison
        // needs the repository list, which arrives later.
        { label: "Adaptivity", href: `${base}/adaptivity`, icon: GitCompare },
      ],
    },
  ];
}

/** Flat repo nav list (command palette, breadcrumb fallbacks, …). */
export function repoNavItems(repoId: string): NavItem[] {
  return repoNavGroups(repoId).flatMap((g) => g.items);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
