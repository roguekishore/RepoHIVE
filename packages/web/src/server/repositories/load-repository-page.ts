import type { RepositoryPage, RepositorySummary } from "@repohive/design/contracts";
import { getAppDatabase } from "@/server/app-db/database";
import { getArtifactStore } from "@/server/hosting/clients";
import { getAppConfig } from "@/server/hosting/config";
import { listIndexedRepositories } from "./list-indexed-repositories";
import { findListedRepository, toRepositoryPage, toRepositorySummary } from "./repository-api";

/**
 * The server-side reader behind `GET /api/repos` and `GET /api/repos/<owner>/<repo>`. A server-component shell calls it
 * directly to render the first page without a round trip; the routes call it to answer the browser. `pageText` is the
 * raw `?page=` value.
 */
export async function loadRepositoryPage(pageText: string | null): Promise<RepositoryPage> {
  const config = getAppConfig();
  return toRepositoryPage(await listIndexedRepositories(getAppDatabase(), config, getArtifactStore(config)), pageText);
}

export async function loadRepositorySummary(owner: string, name: string): Promise<RepositorySummary | undefined> {
  const config = getAppConfig();
  const found = findListedRepository(
    await listIndexedRepositories(getAppDatabase(), config, getArtifactStore(config)),
    owner,
    name,
  );
  return found === undefined ? undefined : toRepositorySummary(found);
}
