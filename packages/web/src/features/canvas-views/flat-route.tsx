"use client";

import { FlatScreen } from "@repohive/design";
import { PageFrame } from "@/features/host/frame-slot";
import { ViewPage } from "./view-page";

/** `/repos/<owner>/<repo>/flat-baseline`: every file and import as one flat graph, for comparison with the hierarchy. */
export function FlatRoute() {
  return (
    <ViewPage view="graph" what="the baseline">
      {(data) => <FlatScreen data={data} Frame={PageFrame} />}
    </ViewPage>
  );
}
