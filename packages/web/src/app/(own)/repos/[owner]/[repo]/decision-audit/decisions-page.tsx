"use client";

import { useSearchParams } from "next/navigation";
import { DecisionsActions, DecisionsScreen } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";
import { useRepository } from "@/features/host/repository-state";

/** The Decisions route shell: the repository and its snapshot state in, the screen out. `?region=` opens on one region. */
export function DecisionsPage() {
  const { owner, name, snapshot } = useRepository();
  const initialRegionId = useSearchParams().get("region") ?? undefined;
  return (
    <PageFrame actions={<DecisionsActions />}>
      <DecisionsScreen owner={owner} name={name} snapshot={snapshot} initialRegionId={initialRegionId} />
    </PageFrame>
  );
}
