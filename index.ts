/**
 * gallery-dl-instagram — platform-agnostic Instagram media extractor SDK.
 *
 * ```ts
 * import { createSDK } from '@chilfish/gallery-dl-instagram'
 *
 * const ig = await createSDK({ cookies: 'ds_user_id=...; sessionid=...' })
 *
 * // Extract metadata only
 * for await (const msg of ig.extract('https://www.instagram.com/p/ABC123/')) {
 *   if (msg.type === 'url') console.log(msg.url)
 * }
 *
 * // Download to disk
 * await ig.download('https://www.instagram.com/p/ABC123/', './downloads')
 * ```
 */

import type { Extractor, Logger } from './core/extractor'
import type { HttpClient, MessageIter, Storage } from './types'
import { ConfigManager } from './config'
import { noopLogger } from './core/extractor'
import { DownloadJob } from './core/job'

import {
  InstagramAvatarExtractor,
  InstagramHighlightsExtractor,
  InstagramInfoExtractor,
  InstagramPostExtractor,
  InstagramPostsExtractor,
  InstagramReelsExtractor,
  InstagramSavedExtractor,
  InstagramStoriesExtractor,
  InstagramTagExtractor,
  InstagramTaggedExtractor,
  InstagramUserExtractor,
} from './instagram/extractors'

// Config
export { ConfigManager } from './config'

// Core
export { Extractor } from './core/extractor'
export type { ExtractorOptions, Logger } from './core/extractor'
export { noopLogger } from './core/extractor'
export { DownloadJob, Job, PrintJob } from './core/job'

// Instagram
export * from './instagram/index'

// Message
export { directory, queue, url } from './message'
export type { MessageIter } from './message'

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

// Sub-extractors (for direct instantiation)
export {
  InstagramAvatarExtractor,
  InstagramHighlightsExtractor,
  InstagramInfoExtractor,
  InstagramPostExtractor,
  InstagramPostsExtractor,
  InstagramReelsExtractor,
  InstagramSavedExtractor,
  InstagramStoriesExtractor,
  InstagramTagExtractor,
  InstagramTaggedExtractor,
  InstagramUserExtractor,
}

export interface SDKOptions {
  /** Custom HttpClient implementation (required). */
  http: HttpClient

  /**
   * Custom Storage implementation for file output.
   * Only needed if you plan to call ``download()``.
   */
  storage?: Storage

  /** Logger instance.  Defaults to a silent no-op logger. */
  log?: Logger

  /** Pre-extracted CSRF token (optional). */
  csrfToken?: string
}

export interface ExtractOptions {
  /** Max posts to extract (for user/tag feeds). */
  maxPosts?: number
  /** Download videos (default: true). */
  videos?: boolean
  /** Max posts to extract (for user/tag feeds). */
  limit?: number
}

export class InstagramSDK {
  readonly http: HttpClient
  readonly storage: Storage
  readonly log: Logger
  readonly config: ConfigManager

  private readonly _csrfToken: string

  constructor(opts: {
    http: HttpClient
    storage?: Storage
    log?: Logger
    csrfToken?: string
  }) {
    this.http = opts.http
    this.storage = opts.storage ?? undefined!
    this.log = opts.log ?? noopLogger
    this.config = new ConfigManager()
    this._csrfToken = opts.csrfToken ?? ''
  }

  /**
   * Extract messages from an Instagram URL without downloading.
   *
   * Returns an async generator yielding Directory / Url / Queue messages.
   * Each ``url`` message includes full metadata (post_id, username, dimensions, etc.).
   */
  async* extract(url: string): MessageIter {
    const extractor = this._resolve(url)
    await extractor.initialize()
    yield* extractor
  }

  /**
   * Download all media from an Instagram URL.
   *
   * Uses the built-in DownloadJob + Storage to save files to disk.
   * Requires ``storage`` to be set in constructor options.
   *
   * ```ts
   * const stats = await ig.download('https://www.instagram.com/p/.../', './my-downloads')
   * // → { posts: 1, files: 9, bytes: 4500000 }
   * ```
   */
  async download(
    url: string,
    outputDir = './data',
  ): Promise<{ posts: number, files: number, bytes: number }> {
    const extractor = this._resolve(url)
    const job = new DownloadJob(extractor as Extractor)
    job.basePath = outputDir

    await job.run()

    return {
      posts: (job as unknown as { _postCount: number })._postCount ?? 0,
      files: (job as unknown as { _fileCount: number })._fileCount ?? 0,
      bytes: (job as unknown as { _downloadedBytes: number })._downloadedBytes ?? 0,
    }
  }

  /** Resolve a URL to an Extractor instance via pattern matching. */
  private _resolve(url: string): Extractor {
    for (const Cls of [
      InstagramPostExtractor,
      InstagramStoriesExtractor,
      InstagramHighlightsExtractor,
      InstagramTagExtractor,
      InstagramSavedExtractor,
      InstagramPostsExtractor,
      InstagramReelsExtractor,
      InstagramTaggedExtractor,
      InstagramInfoExtractor,
      InstagramAvatarExtractor,
      InstagramUserExtractor,
    ]) {
      const match = Cls.pattern.exec(url)
      if (match) {
        const inst = Reflect.construct(Cls, [{
          url,
          match,
          config: this.config,
          http: this.http,
          storage: this.storage,
          log: this.log,
          csrfToken: this._csrfToken,
        }])
        return inst as Extractor
      }
    }

    throw new Error(
      `No extractor matched URL: ${url}. `
      + 'Supported: /p/, /reel/, /{user}/, /stories/, /highlights/, /explore/tags/, /saved/',
    )
  }
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
