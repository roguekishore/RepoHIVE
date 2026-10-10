import type { Metadata } from "next";
import { JobPage } from "./job-page";

export const metadata: Metadata = { title: "Job" };

/** `/jobs/<jobId>`: where one indexing job is. */
export default function Page() {
  return <JobPage />;
}
