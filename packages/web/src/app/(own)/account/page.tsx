import type { Metadata } from "next";
import { AccountRoute } from "./account-route";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return <AccountRoute />;
}
