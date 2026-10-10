import { NotFoundScreen } from "@repohive/design";

/** A repository page that does not exist. Home is the dashboard. */
export default function RepositoryNotFound() {
  return <NotFoundScreen home="repos" />;
}
