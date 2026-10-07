"use client";

import { HierarchyScreen, LinkButton, routes } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";
import { ViewPage } from "./view-page";

const READING = (
  <LinkButton variant="ghost" size="sm" className="rh-hide-sm" href={routes.method}>
    Reading this view
  </LinkButton>
);

/** `/repos/<owner>/<repo>/hierarchy`: the sunburst of the recorded hierarchy. */
export function HierarchyRoute() {
  return (
    <ViewPage view="hierarchyScale" what="the hierarchy">
      {(data, { owner, name }) => (
        <PageFrame fill actions={READING}>
          <HierarchyScreen owner={owner} name={name} data={data} />
        </PageFrame>
      )}
    </ViewPage>
  );
}
