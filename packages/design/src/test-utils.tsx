import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import type { ContractClient } from "./contracts";
import { DesignProvider, type DesignProviderProps, type LinkProps } from "./provider/design-provider";
import type { ThemeStorage } from "./theme/theme";

/** A link that records the click instead of navigating, so a test can see the host's link component was used. */
export function TestLink({ href, children, ...rest }: LinkProps) {
  return (
    <a href={href} data-host-link="true" {...rest}>
      {children}
    </a>
  );
}

export function memoryStorage(initial: Record<string, string> = {}): ThemeStorage & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

export type RenderOptions = Partial<Omit<DesignProviderProps, "children">>;

/** Renders inside a DesignProvider with the test link and an in-memory theme store. */
export function renderWithDesign(ui: ReactElement, options: RenderOptions = {}): RenderResult {
  const themeStorage = memoryStorage();
  // A wrapper, not an element around `ui`, so `rerender` keeps the provider.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DesignProvider Link={TestLink} themeStorage={themeStorage} {...options}>
      {children}
    </DesignProvider>
  );
  return render(ui, { wrapper });
}

export function stubClient(overrides: Partial<ContractClient> = {}): ContractClient {
  const reject = (name: string) => () => Promise.reject(new Error(`stub client: ${name} was not expected`));
  return {
    session: reject("session"),
    signIn: reject("signIn"),
    signUp: reject("signUp"),
    signOut: reject("signOut"),
    quota: reject("quota"),
    requestIndex: reject("requestIndex"),
    job: reject("job"),
    watchJob: () => () => undefined,
    listRepositories: reject("listRepositories"),
    repository: reject("repository"),
    snapshotPointer: reject("snapshotPointer"),
    manifest: reject("manifest"),
    view: reject("view") as ContractClient["view"],
    architectureLevel: reject("architectureLevel"),
    regionDetailIndex: reject("regionDetailIndex"),
    regionDetail: reject("regionDetail"),
    ...overrides,
  };
}
