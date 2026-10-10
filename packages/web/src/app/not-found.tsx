import { Suspense } from "react";
import "@repohive/design/styles.css";
import { NotFoundScreen } from "@repohive/design";
import { DesignHost } from "@/features/host/design-host";
import { OwnFrame } from "@/features/host/frame-slot";

/**
 * The 404 for a URL no page matches (and for the middleware's rewrite of a repository name GitHub would not allow).
 * It sits outside every route group, so it brings the design host and the frame itself; pages inside `(legacy)` use
 * that group's own `not-found.tsx` until the group is empty.
 */
export default function RootNotFound() {
  return (
    <DesignHost>
      <Suspense fallback={null}>
        <OwnFrame>
          <NotFoundScreen home="repos" />
        </OwnFrame>
      </Suspense>
    </DesignHost>
  );
}
