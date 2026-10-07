import { Suspense } from "react";
import "@repohive/design/styles.css";
import { DesignHost } from "@/features/host/design-host";
import { OwnFrame } from "@/features/host/frame-slot";

/**
 * The framed group: app pages drawn by `@repohive/design` inside its app frame (sidebar, header, status line). A page
 * under here renders its screen, and `PageFrame` when it has crumbs or actions of its own. The group name is not part
 * of the URL.
 */
export default function OwnLayout({ children }: { children: React.ReactNode }) {
  return (
    <DesignHost>
      <Suspense fallback={null}>
        <OwnFrame>{children}</OwnFrame>
      </Suspense>
    </DesignHost>
  );
}
