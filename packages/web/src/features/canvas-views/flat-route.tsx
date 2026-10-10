"use client";

import { FlatScreen, LinkButton, routes } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";
import { ViewPage } from "./view-page";

const READING = (
  <LinkButton variant="ghost" size="sm" className="rh-hide-sm" href={routes.method}>
    Reading this view
  </LinkButton>
);

/** `/repos/<owner>/<repo>/flat-baseline`: every file and import as one flat graph, for comparison with the hierarchy. */
export function FlatRoute() {
  return (
    <ViewPage view="graph" what="the baseline">
      {(data) => (
        <PageFrame fill actions={READING}>
          <FlatScreen data={data} />
        </PageFrame>
      )}
    </ViewPage>
  );
}
