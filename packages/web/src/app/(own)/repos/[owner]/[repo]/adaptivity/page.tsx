import type { Metadata } from "next";
import { AdaptivityPage } from "./adaptivity-page";

export const metadata: Metadata = { title: "Adaptivity" };

/** `/repos/<owner>/<repo>/adaptivity`: how often the engine kept a package, and the settings behind the answer. */
export default function Page() {
  return <AdaptivityPage />;
}
