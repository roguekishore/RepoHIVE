/**
 * The job page is a client shell exported once under the placeholder `_`; the
 * host serves it for every real job id and the page reads the id from the
 * browser path (see "Static export and host mapping" in the package README).
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ jobId: "_" }];
}

export default function JobLayout({ children }: { children: React.ReactNode }) {
  return children;
}
