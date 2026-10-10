import type { Metadata } from "next";
import { MapRoute } from "@/features/canvas-views/map-route";

export const metadata: Metadata = { title: "Map" };

export default function MapPage() {
  return <MapRoute />;
}
