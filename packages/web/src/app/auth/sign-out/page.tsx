import type { Metadata } from "next";
import { SignOutForm } from "@/features/account/sign-out-form";

export const metadata: Metadata = { title: "Sign out" };

export default function SignOutPage() {
  return <SignOutForm />;
}
