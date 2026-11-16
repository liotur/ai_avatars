import { Agent, fetch as undiciFetch } from "undici";

/**
 * The fetch used for calls to the language model provider.
 *
 * With `verify` true (the default) it is the normal fetch, which checks the
 * provider's certificate. With `verify` false it skips that check, for a
 * provider whose certificate comes from a company authority that this machine
 * does not trust, such as Amdocs AutoX inside a stock Linux container. It
 * applies to these calls only; nothing else the assistant does is affected.
 *
 * Skipping the check means a party able to intercept the connection could
 * read the requests, the key included. Use it only on a network you trust.
 */
export function providerFetch(verify: boolean): typeof fetch {
  if (verify) return fetch;
  const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher,
    })) as unknown as typeof fetch;
}
