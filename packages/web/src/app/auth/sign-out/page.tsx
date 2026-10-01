import type { Metadata } from "next";
import { SignOutForm } from "@/components/hosting/sign-out-form";

export const metadata: Metadata = { title: "Sign out" };

export default function SignOutPage() {
  return <SignOutForm />;
}
