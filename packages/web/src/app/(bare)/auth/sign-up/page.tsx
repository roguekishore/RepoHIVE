import type { Metadata } from "next";
import { AuthScreen } from "@repohive/design";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return <AuthScreen mode="sign-up" />;
}
