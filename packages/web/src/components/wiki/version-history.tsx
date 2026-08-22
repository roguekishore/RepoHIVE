"use client";

import type { DocPageVersion } from "@repohive/types";
import { VersionHistory as VersionHistoryShell } from "@repohive/ui/wiki/version-history";
import { usePageVersions } from "@/lib/hooks/use-page";

interface Props {
  pageId: string;
  currentVersion: number;
  currentContent: string;
}

export function VersionHistoryWrapper({ pageId, currentVersion, currentContent }: Props) {
  const { versions, isLoading } = usePageVersions(pageId);

  return (
    <VersionHistoryShell
      versions={versions as DocPageVersion[]}
      currentVersion={currentVersion}
      currentContent={currentContent}
      isLoading={isLoading}
    />
  );
}
