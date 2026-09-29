import "server-only";
import { getConfig } from "../config";
import { HiggsfieldProvider } from "./higgsfield";
import type { RegisteredProvider } from "./router";
import type { GenerationProvider } from "./types";
import { ViggleProvider } from "./viggle";

type G = typeof globalThis & { __tmProviders?: GenerationProvider[] };
const g = globalThis as G;

/** All provider adapters known to this build. Adding a provider = add it here. */
export function getProviders(): GenerationProvider[] {
  if (g.__tmProviders) return g.__tmProviders;
  const cfg = getConfig();
  g.__tmProviders = [
    new HiggsfieldProvider({
      keyId: cfg.HF_API_KEY_ID,
      keySecret: cfg.HF_API_KEY_SECRET,
      baseUrl: cfg.HIGGSFIELD_API_BASE,
      timeoutMs: cfg.PROVIDER_REQUEST_TIMEOUT_MS,
    }),
    new ViggleProvider({
      apiKey: cfg.VIGGLE_API_KEY,
      baseUrl: cfg.VIGGLE_API_BASE,
      timeoutMs: cfg.PROVIDER_REQUEST_TIMEOUT_MS,
    }),
  ];
  return g.__tmProviders;
}

export function getProvider(id: string): GenerationProvider | undefined {
  return getProviders().find((p) => p.id === id);
}

export async function registeredProviders(): Promise<RegisteredProvider[]> {
  return Promise.all(
    getProviders().map(async (provider) => ({ provider, configured: await provider.isConfigured() })),
  );
}

/** Test hook: replace the provider set. */
export function setProvidersForTests(providers: GenerationProvider[] | undefined): void {
  g.__tmProviders = providers;
}
