import type { Metadata } from "next";
import { OverviewPage } from "./overview-page";

export const metadata: Metadata = { title: "Overview" };

/** `/repos/<owner>/<repo>/overview`: the repository in figures, and the default view (`DEFAULT_REPO_VIEW`). */
export default function Page() {
  return <OverviewPage />;
}
