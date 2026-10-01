import type { Metadata } from "next";
import { AdaptivityView } from "@/components/adaptivity/adaptivity-view";

export const metadata: Metadata = { title: "Adaptivity" };

/**
 * `/repos/<owner>/<repo>/adaptivity`: the assessed preserve rate of this
 * repository's snapshot. The comparison across repositories needs the list of
 * indexed repositories, which is a later hosting-3 phase.
 */
export default function AdaptivityPage() {
  return <AdaptivityView />;
}
