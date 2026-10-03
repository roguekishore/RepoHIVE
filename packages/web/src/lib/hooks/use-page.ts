"use client";

import useSWR from "swr";
import { getPageById } from "@/lib/api/pages";
import type { PageResponse } from "@/lib/api/types";

/** `repoId` routes the lookup to the right store; a workspace server keeps one
 *  database per repo and the primary cannot see the others' pages. */
export function usePage(pageId: string | null, repoId?: string) {
  const { data, error, isLoading, mutate } = useSWR<PageResponse>(
    pageId ? `page:${pageId}` : null,
    () => getPageById(pageId!, repoId),
    { revalidateOnFocus: false },
  );
  return { page: data, error, isLoading, mutate };
}
