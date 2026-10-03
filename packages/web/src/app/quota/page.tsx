import type { Metadata } from "next";
import { QuotaPanel } from "@/features/account/quota-panel";

export const metadata: Metadata = { title: "Quota" };

export default function QuotaPage() {
  return <QuotaPanel />;
}
