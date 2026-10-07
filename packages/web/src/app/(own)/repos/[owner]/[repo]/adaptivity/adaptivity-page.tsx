"use client";

import { AdaptivityScreen } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";
import { useRepository } from "@/features/host/repository-state";

/** The Adaptivity route shell: the repository and its snapshot state in, the screen out. */
export function AdaptivityPage() {
  const { owner, name, snapshot } = useRepository();
  return (
    <PageFrame>
      <AdaptivityScreen owner={owner} name={name} snapshot={snapshot} />
    </PageFrame>
  );
}
