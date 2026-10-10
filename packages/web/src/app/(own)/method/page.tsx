import type { Metadata } from "next";
import { MethodScreen } from "@repohive/design";

export const metadata: Metadata = { title: "Method" };

/** `/method`: how a hierarchy is built, as a long-form page. */
export default function MethodPage() {
  return <MethodScreen />;
}
