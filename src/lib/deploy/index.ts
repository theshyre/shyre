import "server-only";

import type { DeployProvider } from "./provider";
import { vercelProvider, type VercelDriverConfig } from "./providers/vercel";

export type ProviderId = "vercel";

export function deployProviderFor(
  provider: ProviderId,
  cfg: VercelDriverConfig,
): DeployProvider {
  switch (provider) {
    case "vercel":
      return vercelProvider(cfg);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported deploy provider: ${String(_exhaustive)}`);
    }
  }
}
