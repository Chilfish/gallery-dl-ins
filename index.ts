/**
 * gallery-dl TypeScript port — public API.
 *
 * Usage:
 *
 * ```ts
 * import { DownloadJob, InstagramPostExtractor, ConfigManager } from './ts/index';
 *
 * const config = new ConfigManager({
 *   extractor: {
 *     instagram: {
 *       videos: false,
 *       'max-posts': 10,
 *     },
 *   },
 * });
 *
 * const opts = {
 *   url: 'https://www.instagram.com/p/CxAbCdEfGh/',
 *   match: InstagramPostExtractor.pattern.exec('https://www.instagram.com/p/CxAbCdEfGh/')!,
 *   config,
 *   http,           // your HttpClient implementation
 *   storage,        // your Storage implementation
 *   log: console,   // or custom Logger
 * };
 *
 * const extractor = new InstagramPostExtractor(opts);
 * const job = new DownloadJob(extractor);
 * const status = await job.run();
 * ```
 */

import type { Logger } from './core/extractor'
import type { HttpClient, Storage } from './types'
import { createHttpClient, createStorage, extractCsrfFromCookies } from './cli/adapter'
import { noopLogger } from './core/extractor'

// Config
export { ConfigManager } from './config'
// Core
export { Extractor } from './core/extractor'
export type {
  ExtractorOptions,
  Logger,
} from './core/extractor'
export { noopLogger } from './core/extractor'

export { DownloadJob, Job, PrintJob } from './core/job'

// Instagram
export * from './instagram/index'
// Message
export { directory, queue, url } from './message'

export type { MessageIter } from './message'

// SDK (high-level) — platform-agnostic class
export { InstagramSDK } from './sdk'

export type { ExtractOptions, SDKOptions } from './sdk'
// Types
export type {
  Config,
  ConfigValue,
  DirectoryMsg,
  ExtractorClass,
  HttpClient,
  HttpResponse,
  Message,
  Metadata,
  QueueMsg,
  RequestConfig,
  Storage,
  UrlMsg,
} from './types'

// Utils
export { idFromShortcode, shortcodeFromId } from './utils/id-codec'
export {
  ensureHttpScheme,
  extr,
  extract,
  findTags,
  nameExtFromURL,
  parseInt,
  parseUnicodeEscapes,
  unescape,
  unquote,
} from './utils/text'

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
 * import { createSDK } from '@chilfish/gallery-dl-instagram'
 *
 * // Node.js with cookies
 * const ig = await createSDK({ cookies: 'ds_user_id=...; sessionid=...' })
 *
 * // Custom http adapter (browser / Deno / Edge)
 * const ig = await createSDK({ http: myHttpClient, storage: myStorage })
 * ```
 */
export async function createSDK(opts: CreateSDKOptions = {}): Promise<import('./sdk').InstagramSDK> {
  const { InstagramSDK } = await import('./sdk')
  const log = opts.log ?? noopLogger
  const storage = opts.storage ?? createStorage()

  let http: HttpClient
  let csrfToken = ''

  if (opts.http) {
    http = opts.http
  }
  else if (opts.cookies) {
    csrfToken = extractCsrfFromCookies(opts.cookies)
    http = createHttpClient(undefined, opts.cookies, log)
  }
  else {
    throw new Error(
      'Either "cookies" or "http" must be provided. '
      + 'Get cookies from browser DevTools → Application → Cookies → instagram.com',
    )
  }

  return new InstagramSDK({ http, storage, log, csrfToken })
}
