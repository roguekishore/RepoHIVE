import type { Metadata } from "next";
import { RequestIndexForm } from "@/components/hosting/request-index-form";

export const metadata: Metadata = { title: "Request index" };

export default function RequestIndexPage() {
  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="mb-4 text-lg font-medium">Request an index</h1>
      <RequestIndexForm />
    </div>
  );
}
