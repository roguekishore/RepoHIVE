import type { Metadata } from "next";
import { FlatRoute } from "@/features/canvas-views/flat-route";

export const metadata: Metadata = { title: "Baseline" };

export default function BaselinePage() {
  return <FlatRoute />;
}
