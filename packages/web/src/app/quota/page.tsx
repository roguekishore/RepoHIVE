import type { Metadata } from "next";
import { QuotaPanel } from "@/components/hosting/quota-panel";

export const metadata: Metadata = { title: "Quota" };

export default function QuotaPage() {
  return <QuotaPanel />;
}
