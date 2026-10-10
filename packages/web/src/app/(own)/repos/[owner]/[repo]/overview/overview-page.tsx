"use client";

import { useMemo } from "react";
import { OverviewActions, OverviewScreen } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";
import { useRepository } from "@/features/host/repository-state";

/** The Overview's route shell: the repository and its snapshot state in, the screen and its top-bar actions out. */
export function OverviewPage() {
  const { owner, name, snapshot } = useRepository();
  const actions = useMemo(() => <OverviewActions owner={owner} name={name} />, [owner, name]);
  return (
    <PageFrame actions={snapshot.status === "ready" ? actions : undefined}>
      <OverviewScreen owner={owner} name={name} snapshot={snapshot} />
    </PageFrame>
  );
}
