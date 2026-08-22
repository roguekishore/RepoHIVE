"use client";

import { ModelSelector as ModelSelectorShell } from "@repohive/ui/chat/model-selector";
import { useProviders } from "@/lib/hooks/use-providers";

export function ModelSelector({ repoId }: { repoId?: string }) {
  const {
    providers,
    activeProvider,
    activeModel,
    isLoading,
    activate,
    saveKey,
  } = useProviders(repoId);

  return (
    <ModelSelectorShell
      providers={providers}
      activeProvider={activeProvider}
      activeModel={activeModel}
      isLoading={isLoading}
      onActivate={(id, model) => activate(id, model)}
      onSaveKey={saveKey}
    />
  );
}
