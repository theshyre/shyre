import "server-only";

import type { MessageSender } from "../sender";
import { resendSender } from "./resend";

/**
 * Provider registry. Today only Resend; the registry exists so the
 * send / verify call sites stay provider-agnostic. Adding Postmark
 * is one new file in this directory + a case here.
 */
export type ProviderId = "resend";

export function senderFor(provider: ProviderId, apiKey: string): MessageSender {
  switch (provider) {
    case "resend":
      return resendSender(apiKey);
    default: {
      // exhaustive check — TS errors if a new provider is added to
      // ProviderId without a case here.
      const _exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${String(_exhaustive)}`);
    }
  }
}
