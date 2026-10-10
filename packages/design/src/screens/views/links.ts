import { routes } from "../../routes";

/** The Decisions page, with one region picked when a region id is given (the Overview links to it this way). */
export function decisionsHref(owner: string, name: string, regionId?: string): string {
  const base = routes.repoView(owner, name, "decision-audit");
  return regionId === undefined ? base : `${base}?region=${encodeURIComponent(regionId)}`;
}
