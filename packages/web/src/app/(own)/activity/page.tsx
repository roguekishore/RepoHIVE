import type { Metadata } from "next";
import { ActivityRoute } from "./activity-route";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return <ActivityRoute />;
}
