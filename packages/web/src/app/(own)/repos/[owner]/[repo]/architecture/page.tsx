import type { Metadata } from "next";
import { ArchitectureRoute } from "@/features/canvas-views/architecture-route";

export const metadata: Metadata = { title: "Architecture" };

export default function ArchitecturePage() {
  return <ArchitectureRoute />;
}
