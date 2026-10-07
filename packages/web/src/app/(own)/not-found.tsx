import { NotFoundScreen } from "@repohive/design";

/** A page inside the app that does not exist, shown in the frame. Home is the dashboard. */
export default function AppNotFound() {
  return <NotFoundScreen home="repos" />;
}
