import type { Metadata } from "next";
import { AuthScreen } from "@repohive/design";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return <AuthScreen mode="sign-in" />;
}
