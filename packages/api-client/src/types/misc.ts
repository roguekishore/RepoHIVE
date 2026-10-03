// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: string;
  db: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

interface ProviderInfo {
  id: string;
  name: string;
  models: string[];
  default_model: string;
  configured: boolean;
}

export interface ProvidersResponse {
  active: {
    provider: string | null;
    model: string | null;
  };
  providers: ProviderInfo[];
}

// ---------------------------------------------------------------------------
// Scoped generation (POST /repos/{id}/generate[/estimate])
// ---------------------------------------------------------------------------

export type GenerateCascade = "none" | "dependents" | "full";

// ---------------------------------------------------------------------------
// API error
// ---------------------------------------------------------------------------

export interface ApiError {
  detail: string;
  status: number;
}
