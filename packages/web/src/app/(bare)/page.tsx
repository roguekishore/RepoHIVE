import type { Metadata } from "next";
import { BROADLEAF_FIGURES, LandingScreen } from "@repohive/design";

// `absolute`: the landing is the product's own page, so the "%s — RepoHIVE" template does not apply.
export const metadata: Metadata = { title: { absolute: "RepoHIVE" } };

/** `/`: the landing page. Its figures are the committed ones a script wrote from a real BroadleafCommerce index. */
export default function LandingPage() {
  return <LandingScreen figures={BROADLEAF_FIGURES} />;
}
