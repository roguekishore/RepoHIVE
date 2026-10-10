import type { Metadata } from "next";
import { DecisionsPage } from "./decisions-page";

export const metadata: Metadata = { title: "Decisions" };

/** `/repos/<owner>/<repo>/decision-audit`: what the engine decided for each region, as recorded. */
export default function Page() {
  return <DecisionsPage />;
}
