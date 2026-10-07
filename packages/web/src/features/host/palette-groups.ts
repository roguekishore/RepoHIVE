import {
  globalNav,
  parseRepoPath,
  rankMatches,
  repoNav,
  routes,
  type PaletteGroup,
  type PaletteItem,
  type RepositoryListItem,
} from "@repohive/design";

const PALETTE_LIMIT = 8;

/**
 * The ⌘K palette's contents for the TS host: the pages, the views of the repository the visitor is in, and the
 * repositories that are indexed. Everything is a link the navigation already has, so nothing here is recomputed.
 * Regions and files are added by the screens that load them.
 */
export function navigationGroups(
  pathname: string,
  repositories: readonly RepositoryListItem[],
  query: string,
): readonly PaletteGroup[] {
  const repo = parseRepoPath(pathname);
  const pages: PaletteItem[] = globalNav(true).map((entry) => ({
    id: `page:${entry.id}`,
    label: entry.label,
    icon: entry.icon,
    href: entry.href,
  }));
  const views: PaletteItem[] =
    repo === undefined
      ? []
      : repoNav(repo.owner, repo.name).map((entry) => ({
          id: `view:${entry.id}`,
          label: entry.label,
          meta: `${repo.owner}/${repo.name}`,
          icon: entry.icon,
          href: entry.href,
        }));
  const repos: PaletteItem[] = repositories.map((item) => {
    const [owner = "", name = ""] = item.repoId.split("/");
    return { id: `repo:${item.repoId}`, label: item.repoId, icon: "repo", href: routes.repo(owner, name) };
  });
  return [
    { label: "Pages", items: rankMatches(pages, (item) => item.label, query, PALETTE_LIMIT) },
    { label: "Views", items: rankMatches(views, (item) => item.label, query, PALETTE_LIMIT) },
    { label: "Repositories", items: rankMatches(repos, (item) => item.label, query, PALETTE_LIMIT) },
  ];
}
