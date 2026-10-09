import "@repohive/design/styles.css";
import { DesignHost } from "@/features/host/design-host";

/**
 * The bare group: pages drawn by `@repohive/design` with no app frame, namely the landing and the sign-in and sign-up
 * pages (the Screens artifact shows both without the sidebar). The group name is not part of the URL.
 */
export default function BareLayout({ children }: { children: React.ReactNode }) {
  return (
    <DesignHost>
      <main id="main-content" className="min-h-dvh bg-[var(--rh-bg)]">
        {children}
      </main>
    </DesignHost>
  );
}
