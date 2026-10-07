import type { Metadata } from "next";
import { CirclesRoute } from "@/features/canvas-views/circles-route";

export const metadata: Metadata = { title: "Circles" };

export default function CirclesPage() {
  return <CirclesRoute />;
}
