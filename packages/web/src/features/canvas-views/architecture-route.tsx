"use client";

import { ArchitectureScreen, LinkButton, routes } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";
import { ViewPage } from "./view-page";

const READING = (
  <LinkButton variant="ghost" size="sm" className="rh-hide-sm" href={routes.method}>
    Reading this view
  </LinkButton>
);

/** `/repos/<owner>/<repo>/architecture`: the dependency matrix between groups and the evidence behind it. */
export function ArchitectureRoute() {
  return (
    <ViewPage view="architecture" what="the architecture">
      {(data) => (
        <PageFrame actions={READING}>
          <ArchitectureScreen data={data} />
        </PageFrame>
      )}
    </ViewPage>
  );
}
