/**
 * Node.js convenience factory for InstagramSDK.
 *
 * Creates an InstagramSDK instance with native-fetch HttpClient and fs-based Storage.
 * Only use this in Node.js environments.
 *
 * ```ts
 * import { createSDK } from '@chilfish/gallery-dl-instagram/node'
 * const ig = await createSDK({ cookies: 'ds_user_id=...; sessionid=...' })
 * ```
 */

import type { Logger } from './core/extractor'
import type { FetchClientOptions } from './fetcher'
import type { HttpClient, Storage } from './types'
import { noopLogger } from './core/extractor'
import { createFetchHttpClient, extractCsrf } from './fetcher'
import { assertHttpProxy, createBunProxyHttpClient, isBunRuntime } from './proxy'
import { InstagramSDK } from './sdk'

/**
 * Creates a fetch client that routes through an HTTP(S) proxy.
 *
 * Bun uses the native `fetch` proxy option; Node uses undici's `ProxyAgent`
 * (lazily imported, optional peer dependency). SOCKS proxies are not supported
 * by the fetch transport.
 *
 * ```ts
 * import { createProxyFetch } from '@chilfish/gallery-dl-instagram/node'
 * const http = createProxyFetch('http://127.0.0.1:7890')
 * ```
 */
export function createProxyFetch(
  proxy: string,
  opts: Omit<FetchClientOptions, 'init'> = {},
): HttpClient {
  assertHttpProxy(proxy)

  if (isBunRuntime())
    return createBunProxyHttpClient(proxy)

  let dispatcherPromise: Promise<unknown> | undefined

  const getDispatcher = async (): Promise<unknown> => {
    dispatcherPromise ??= import('undici')
      .then(({ ProxyAgent }) => new ProxyAgent(proxy))
      .catch(() => {
        throw new Error(
          'Proxy support requires the optional peer dependency "undici". '
          + 'Install it with `bun add undici` (or `npm i undici`).',
        )
      })
    return dispatcherPromise
  }

  return createFetchHttpClient({
    ...opts,
    async init() {
      return { dispatcher: await getDispatcher() } as RequestInit
    },
  })
}

/** Options for the Node.js convenience factory. */
export interface CreateSDKOptions {
  /**
   * Full browser Cookie header string.
   * Copy from DevTools → Network → Request Headers → Cookie.
   * Auto-extracts csrftoken for X-CSRFToken header.
   *
   * Either ``cookies`` or ``http`` must be provided.
   */
  cookies?: string

  /**
   * Custom HttpClient implementation.
   * If omitted, a Node.js native-fetch client is created from ``cookies``.
   */
  http?: HttpClient

  /**
   * HTTP(S) proxy URL, e.g. ``http://127.0.0.1:7890``.
   * Falls back to ``http_proxy`` / ``HTTPS_PROXY`` / ``https_proxy`` env vars.
   * Pass ``null`` to disable the env fallback. Ignored when ``http`` is given.
   *
   * On Node this requires the optional peer dependency ``undici``.
   */
  proxy?: string | null

  /**
   * Custom Storage implementation for file output.
   * Defaults to Node.js fs/promises-based storage.
   */
  storage?: Storage

  /**
   * Logger instance.  Defaults to a silent no-op logger.
   */
  log?: Logger
}

/** Read a proxy URL from the conventional environment variables. */
function readEnvProxy(): string | undefined {
  if (typeof process === 'undefined')
    return undefined
  return process.env.http_proxy || process.env.HTTPS_PROXY || process.env.https_proxy || undefined
}

/**
 * Create an SDK instance with Node.js defaults.
 *
 * When ``cookies`` is provided, auto-creates a native-fetch HttpClient
 * with CSRF token extraction.  Pass ``http`` directly for custom adapters.
 *
 * ```ts
 * import { createSDK } from '@chilfish/gallery-dl-instagram/node'
 *
 * // Node.js with cookies
 * const ig = await createSDK({ cookies: 'ds_user_id=...; sessionid=...' })
 *
 * // Route all requests through a proxy
 * const ig = await createSDK({ cookies: '...', proxy: 'http://127.0.0.1:7890' })
 *
 * // Custom http adapter (browser / Deno / Edge)
 * const ig = await createSDK({ http: myHttpClient, storage: myStorage })
 * ```
 */
export async function createSDK(opts: CreateSDKOptions = {}): Promise<InstagramSDK> {
  const log = opts.log ?? noopLogger

  let http: HttpClient | undefined = opts.http
  let storage: Storage | undefined = opts.storage
  let csrfToken = ''

  if (!http) {
    const proxy = opts.proxy === null
      ? undefined
      : opts.proxy ?? readEnvProxy()

    http = proxy
      ? createProxyFetch(proxy, { cookie: opts.cookies })
      : createFetchHttpClient({ cookie: opts.cookies })

    if (opts.cookies)
      csrfToken = extractCsrf(opts.cookies)

    // Only import fs-based storage if caller didn't provide one (e.g. Vercel serverless)
    if (!storage) {
      const { createStorage } = await import('./cli/storage')
      storage = createStorage()
    }
  }

  return new InstagramSDK({ http, storage, log, csrfToken })
}
