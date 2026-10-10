import type { Metadata } from "next";
import { DashboardRoute } from "./dashboard-route";

export const metadata: Metadata = { title: "Repositories" };

export default function ReposPage() {
  return <DashboardRoute />;
}
