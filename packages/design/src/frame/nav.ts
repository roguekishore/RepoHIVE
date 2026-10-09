import type { IconName } from "../icons/icons";
import { routes, type RepoView } from "../routes";

export interface NavEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly href: string;
}

/** The global group. Activity is listed only when the host can serve a job list (`showActivity`). */
export function globalNav(showActivity: boolean): readonly NavEntry[] {
  return [
    { id: "repos", label: "Repositories", icon: "list", href: routes.repos },
    ...(showActivity ? [{ id: "activity", label: "Activity", icon: "activity" as const, href: routes.activity }] : []),
    { id: "method", label: "Method", icon: "book", href: routes.method },
  ];
}

/** Labels differ from the paths: the URLs of the older views stay, only the words change. */
const REPO_NAV: readonly { readonly view: RepoView; readonly label: string; readonly icon: IconName }[] = [
  { view: "overview", label: "Overview", icon: "overview" },
  { view: "knowledge-graph", label: "Map", icon: "map" },
  { view: "hierarchy", label: "Hierarchy", icon: "hierarchy" },
  { view: "decision-audit", label: "Decisions", icon: "decide" },
  { view: "architecture", label: "Architecture", icon: "layers" },
  { view: "flat-baseline", label: "Baseline", icon: "graph" },
  { view: "adaptivity", label: "Adaptivity", icon: "compare" },
  { view: "circles", label: "Circles", icon: "circles" },
];

/** The repository group, in order. Circles is last: it is a prototype and stays reachable without being promoted. */
export function repoNav(owner: string, name: string): readonly (NavEntry & { readonly view: RepoView })[] {
  return REPO_NAV.map((entry) => ({
    id: entry.view,
    view: entry.view,
    label: entry.label,
    icon: entry.icon,
    href: routes.repoView(owner, name, entry.view),
  }));
}

/** The view's label as the navigation words it, for crumbs and titles. */
export function repoViewLabel(view: RepoView): string {
  return REPO_NAV.find((entry) => entry.view === view)?.label ?? view;
}
