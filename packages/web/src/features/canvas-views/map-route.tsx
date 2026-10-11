"use client";

import { MapScreen } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";
import { ViewPage } from "./view-page";

/** `/repos/<owner>/<repo>/knowledge-graph`: the Map, the recorded hierarchy as cards you zoom into. */
export function MapRoute() {
  return (
    <ViewPage view="zoomMap" what="the map">
      {(data, repository) => <MapScreen data={data} Frame={PageFrame} repository={repository} />}
    </ViewPage>
  );
}
