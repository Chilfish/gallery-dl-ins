/**
 * Node.js convenience factory for InstagramSDK.
 *
 * Creates an InstagramSDK instance with axios-based HttpClient and fs-based Storage.
 * Only use this in Node.js environments.
 *
 * ```ts
 * import { createSDK } from '@chilfish/gallery-dl-instagram/node'
 * const ig = await createSDK({ cookies: 'ds_user_id=...; sessionid=...' })
 * ```
 */

import type { Logger } from './core/extractor'
import type { HttpClient, Storage } from './types'
import { noopLogger } from './core/extractor'
import { InstagramSDK } from './sdk'

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
   * If omitted, a Node.js axios-based client is created from ``cookies``.
   */
  http?: HttpClient

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

/**
 * Create an SDK instance with Node.js defaults.
 *
 * When ``cookies`` is provided, auto-creates an axios-based HttpClient
 * with CSRF token extraction.  Pass ``http`` directly for custom adapters.
 *
 * ```ts
 * import { createSDK } from '@chilfish/gallery-dl-instagram/node'
 *
 * // Node.js with cookies
 * const ig = await createSDK({ cookies: 'ds_user_id=...; sessionid=...' })
 *
 * // Custom http adapter (browser / Deno / Edge)
 * const ig = await createSDK({ http: myHttpClient, storage: myStorage })
 * ```
 */
export async function createSDK(opts: CreateSDKOptions = {}): Promise<InstagramSDK> {
  const log = opts.log ?? noopLogger

  let http: HttpClient
  let storage: Storage | undefined = opts.storage
  let csrfToken = ''

  if (opts.http) {
    http = opts.http
  }
  else if (opts.cookies) {
    // Dynamic import — only loads Node.js adapter when createSDK is actually called
    const { createHttpClient, extractCsrfFromCookies } = await import('./cli/adapter')
    csrfToken = extractCsrfFromCookies(opts.cookies)
    http = createHttpClient(undefined, opts.cookies, log)
    // Only import fs-based storage if caller didn't provide one (e.g. Vercel serverless)
    if (!storage) {
      const { createStorage } = await import('./cli/storage')
      storage = createStorage()
    }
  }
  else {
    throw new Error(
      'Either "cookies" or "http" must be provided. '
      + 'Get cookies from browser DevTools → Application → Cookies → instagram.com',
    )
  }

  return new InstagramSDK({ http, storage, log, csrfToken })
}
