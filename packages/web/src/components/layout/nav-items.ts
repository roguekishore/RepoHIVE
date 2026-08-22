/**
 * Single source of truth for app navigation. Both the desktop sidebar and
 * the mobile nav consume these — the two surfaces must never diverge again.
 *
 * Repo IA (6 groups + Settings pinned last):
 *   Overview · Docs · Architecture · Knowledge Graph · Code Health ·
 *   People & History · Chat
 */

import {
  Activity,
  BarChart3,
  BookOpen,
  Boxes,
  ClipboardList,
  DollarSign,
  FolderTree,
  GitCommitHorizontal,
  GitMerge,
  HeartPulse,
  LayoutDashboard,
  Layers,
  Lightbulb,
  Link2,
  MessageSquare,
  Network,
  ScanSearch,
  Settings,
  ShieldCheck,
  Users,
  Waypoints,
  Wrench,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

export interface NavGroup {
  /** Optional section label rendered above the items. */
  label?: string;
  items: NavItem[];
}

export const GLOBAL_NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Settings", href: "/settings", icon: Settings },
];

export const WORKSPACE_NAV: NavItem[] = [
  { label: "Overview", href: "/workspace", icon: Layers, exact: true },
  { label: "System Map", href: "/workspace/system-map", icon: Waypoints },
  { label: "Conformance", href: "/workspace/conformance", icon: ShieldCheck },
  { label: "Contracts", href: "/workspace/contracts", icon: Link2 },
  { label: "Co-Changes", href: "/workspace/co-changes", icon: GitMerge },
];

/**
 * The full vendored repo information architecture. Retained in source (spec
 * R9.6) so any surface can be re-enabled later — by listing it in
 * {@link repoNavGroups} — without re-vendoring. This is NOT the active
 * registry; nothing renders from it while it is not referenced by
 * `repoNavGroups`.
 */
export function allRepoNavGroups(repoId: string): NavGroup[] {
  const base = `/repos/${repoId}`;
  return [
    {
      items: [
        { label: "Overview", href: `${base}/overview`, icon: Activity },
        { label: "Docs", href: `${base}/docs`, icon: BookOpen },
        { label: "Architecture", href: `${base}/architecture`, icon: Boxes },
        { label: "Knowledge Graph", href: `${base}/knowledge-graph`, icon: ScanSearch },
        { label: "Code Health", href: `${base}/code-health`, icon: HeartPulse },
        { label: "Refactoring", href: `${base}/refactoring`, icon: Wrench },
        { label: "Files", href: `${base}/files`, icon: FolderTree },
      ],
    },
    {
      label: "People & History",
      items: [
        { label: "Commits", href: `${base}/commits`, icon: GitCommitHorizontal },
        { label: "Contributors", href: `${base}/owners`, icon: Users },
        { label: "Decisions", href: `${base}/decisions`, icon: Lightbulb },
      ],
    },
    {
      items: [{ label: "Chat", href: `${base}/chat`, icon: MessageSquare }],
    },
    {
      label: "Settings",
      items: [
        { label: "Stats", href: `${base}/stats`, icon: BarChart3 },
        { label: "Usage & savings", href: `${base}/costs`, icon: DollarSign },
        { label: "Settings", href: `${base}/settings`, icon: Settings },
      ],
    },
  ];
}

/**
 * The gated repo navigation — the single declarative source of
 * Reachable_Surfaces (spec R9.1). Only surfaces RepoHIVE's engine genuinely
 * feeds are listed; everything else stays vendored but unreachable (R9.3/R9.6).
 *
 * Phase 1 (Reviews 2–3): Knowledge Graph only. To make another surface
 * reachable later, move its item here from {@link allRepoNavGroups} once its
 * data adapter exists (R9.5).
 */
export function repoNavGroups(repoId: string): NavGroup[] {
  const base = `/repos/${repoId}`;
  return [
    {
      items: [
        { label: "Knowledge Graph", href: `${base}/knowledge-graph`, icon: ScanSearch },
        // Phase D — both read data RepoHIVE's engine produces (R9.3).
        { label: "Flat baseline", href: `${base}/flat-baseline`, icon: Network },
        { label: "Decision audit", href: `${base}/decision-audit`, icon: ClipboardList },
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
