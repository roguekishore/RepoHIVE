"use client";

import { LinkButton, MapScreen, routes } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";
import { ViewPage } from "./view-page";

const READING = (
  <LinkButton variant="ghost" size="sm" className="rh-hide-sm" href={routes.method}>
    Reading this view
  </LinkButton>
);

/** `/repos/<owner>/<repo>/knowledge-graph`: the Map, the recorded hierarchy as cards you zoom into. */
export function MapRoute() {
  return (
    <ViewPage view="zoomMap" what="the map">
      {(data) => (
        <PageFrame fill actions={READING}>
          <MapScreen data={data} />
        </PageFrame>
      )}
    </ViewPage>
  );
}
