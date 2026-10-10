import type { Metadata } from "next";
import { HierarchyRoute } from "@/features/canvas-views/hierarchy-route";

export const metadata: Metadata = { title: "Hierarchy" };

export default function HierarchyPage() {
  return <HierarchyRoute />;
}
