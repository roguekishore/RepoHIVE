import type { Metadata } from "next";
import { AdaptivityView } from "@/components/adaptivity/adaptivity-view";

export const metadata: Metadata = { title: "Adaptivity" };

/**
 * `/adaptivity` — deliberately not repo-scoped.
 *
 * The surface compares repositories against each other, so it cannot live
 * under `/repos/[id]`. It reads every indexed fixture and shows the assessed
 * preserve rate of each.
 */
export default function AdaptivityPage() {
  return <AdaptivityView />;
}
