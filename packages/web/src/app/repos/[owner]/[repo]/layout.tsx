import { RepoShell } from "@/features/repository/repo-shell";

/**
 * Every repository page lives under `/repos/<owner>/<repo>/...`. The static
 * export has one copy of this tree, under the placeholder params below; the
 * host serves it for every real owner and repo, and `RepoShell` reads the
 * real ones from the browser path (see "Static export and host mapping" in the
 * package README).
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ owner: "_", repo: "_" }];
}

export default function RepoLayout({ children }: { children: React.ReactNode }) {
  return <RepoShell>{children}</RepoShell>;
}
