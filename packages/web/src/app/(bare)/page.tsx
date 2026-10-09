import type { Metadata } from "next";
import { BROADLEAF_FIGURES, HiveLanding } from "@repohive/design";

// `absolute`: the landing is the product's own page, so the "%s - RepoHIVE" template does not apply.
export const metadata: Metadata = { title: { absolute: "RepoHIVE" } };

/**
 * `/`: the landing page, in the Hive Core design. Its figures are the committed ones a script wrote from a real
 * BroadleafCommerce index. (The previous landing, `LandingScreen`, is still exported by the design package.)
 */
export default function LandingPage() {
  return <HiveLanding figures={BROADLEAF_FIGURES} />;
}
