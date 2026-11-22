/**
 * Platform-aware proxy helpers for the built-in fetch client.
 *
 * Only Bun exposes a native `fetch` proxy option. Node needs the optional
 * ``undici`` peer dependency — see ``createProxyFetch`` in ``./node``.
 * Workers, Deno and browsers have no native fetch proxy option.
 */

import type { HttpClient } from './types'
import { createFetchHttpClient } from './fetcher'

interface BunRequestInit extends RequestInit {
  /** Bun's native proxy option. */
  proxy?: string
}

/** Whether the current runtime is Bun. */
export function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
}

/** Rejects proxy URLs the fetch transport cannot handle. */
export function assertHttpProxy(proxy: string): void {
  if (!proxy.startsWith('http://') && !proxy.startsWith('https://'))
    throw new Error(`Unsupported proxy scheme for the fetch transport: ${proxy}. Use http:// or https://`)
}

/**
 * Creates a proxy `HttpClient` backed by Bun's native `fetch` `proxy` option.
 *
 * Kept separate from {@link createProxyHttpClient} so the Node adapter can
 * reuse the same scheme validation and runtime check without pulling undici
 * into the core bundle.
 */
export function createBunProxyHttpClient(proxy: string): HttpClient {
  assertHttpProxy(proxy)

  return createFetchHttpClient({
    init: () => ({ proxy } as BunRequestInit),
  })
}

/**
 * Creates a proxy `HttpClient` for the current runtime.
 *
 * Bun uses the native fetch proxy option. Node must use `createProxyFetch`
 * from `@chilfish/gallery-dl-instagram/node`, which adds the optional undici
 * dispatcher; the core entry intentionally does not import undici so Workers
 * stay buildable.
 */
export function createProxyHttpClient(proxy: string): HttpClient {
  if (isBunRuntime())
    return createBunProxyHttpClient(proxy)

  throw new Error(
    'Native proxy support is only available on Bun. '
    + 'On Node use `createProxyFetch` from `@chilfish/gallery-dl-instagram/node`; '
    + 'Workers, Deno and browsers have no native proxy option.',
  )
}
