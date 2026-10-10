"use client";

import { CirclesScreen, LinkButton, routes } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";
import { ViewPage } from "./view-page";

const READING = (
  <LinkButton variant="ghost" size="sm" className="rh-hide-sm" href={routes.method}>
    Reading this view
  </LinkButton>
);

/** `/repos/<owner>/<repo>/circles`: the prototype circle graph, the hierarchy as circles inside circles. */
export function CirclesRoute() {
  return (
    <ViewPage view="zoomMap" what="the circles">
      {(data) => (
        <PageFrame fill actions={READING}>
          <CirclesScreen data={data} />
        </PageFrame>
      )}
    </ViewPage>
  );
}
