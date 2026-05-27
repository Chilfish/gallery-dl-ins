/**
 * High-level SDK entry point — the fastest way to use gallery-dl-ins.
 *
 * ```ts
 * import { createSDK } from '@chilfish/gallery-dl-instagram/sdk'
 *
 * const instagram = createSDK({
 *   cookies: 'ds_user_id=...; sessionid=...; csrftoken=...',
 * })
 *
 * // Just extract metadata (no download):
 * for await (const msg of instagram.extract('https://www.instagram.com/p/.../')) {
 *   if (msg.type === 'url') console.log(msg.url)
 * }
 *
 * // Download directly:
 * await instagram.download('https://www.instagram.com/p/.../', './downloads')
 * ```
 *
 * Or use custom adapters for browser / Deno / Edge:
 * ```ts
 * const instagram = createSDK({
 *   http: myHttpClient,     // your HttpClient implementation
 *   storage: myStorage,     // your Storage implementation (optional)
 *   log: myLogger,          // your Logger implementation (optional)
 * })
 * ```
 */

import { ConfigManager } from './config'
import { DownloadJob } from './core/job'
import type { Extractor } from './core/extractor'
import type { Logger } from './core/extractor'
import { noopLogger } from './core/extractor'
import { extractCsrfFromCookies, createHttpClient } from './cli/adapter'
import { createStorage } from './cli/adapter'
import {
  InstagramPostExtractor,
  InstagramUserExtractor,
  InstagramStoriesExtractor,
  InstagramHighlightsExtractor,
  InstagramTagExtractor,
  InstagramSavedExtractor,
} from './instagram/extractors'
import type { HttpClient, MessageIter, Storage } from './types'

// Re-export sub-extractor classes for type use
export {
  InstagramPostExtractor,
  InstagramUserExtractor,
  InstagramStoriesExtractor,
  InstagramHighlightsExtractor,
  InstagramTagExtractor,
  InstagramSavedExtractor,
}

export interface SDKOptions {
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

  private constructor(opts: {
    http: HttpClient
    storage: Storage
    log: Logger
    config: ConfigManager
    csrfToken: string
  }) {
    this.http = opts.http
    this.storage = opts.storage
    this.log = opts.log
    this.config = opts.config
    this._csrfToken = opts.csrfToken
  }

  /** Factory */

  /**
   * Create an InstagramSDK instance.
   *
   * Provides sensible Node.js defaults when ``cookies`` is given.
   * Pass ``http`` / ``storage`` / ``log`` for custom platforms.
   */
  static async create(opts: SDKOptions = {}): Promise<InstagramSDK> {
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

    const config = new ConfigManager()

    return new InstagramSDK({ http, storage, log, config, csrfToken })
  }

  /** High-level API */

  /**
   * Extract messages from an Instagram URL without downloading.
   *
   * Returns an async generator yielding Directory / Url / Queue messages.
   * Each ``url`` message includes full metadata (post_id, username, dimensions, etc.).
   *
   * ```ts
   * for await (const msg of instagram.extract('https://www.instagram.com/p/.../')) {
   *   if (msg.type === 'url') {
   *     console.log(msg.url, msg.metadata.media_id)
   *   }
   * }
   * ```
   */
  async *extract(url: string): MessageIter {
    const extractor = this._resolve(url)
    await extractor.initialize()
    yield* extractor
  }

  /**
   * Download all media from an Instagram URL.
   *
   * Uses the built-in DownloadJob + Storage to save files to disk.
   *
   * ```ts
   * const stats = await instagram.download(
   *   'https://www.instagram.com/p/.../',
   *   './my-downloads',
   * )
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

  /** Internal */

  /**
   * Resolve a URL to an Extractor instance via pattern matching.
   */
  private _resolve(url: string): Extractor {
    for (const Cls of [
      InstagramPostExtractor,
      InstagramUserExtractor,
      InstagramStoriesExtractor,
      InstagramHighlightsExtractor,
      InstagramTagExtractor,
      InstagramSavedExtractor,
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

/**
 * Shorthand: create an SDK instance with Node.js defaults.
 *
 * ```ts
 * import { createSDK } from '@chilfish/gallery-dl-instagram/sdk'
 * const ig = await createSDK({ cookies: '...' })
 * ```
 */
export function createSDK(opts: SDKOptions): Promise<InstagramSDK> {
  return InstagramSDK.create(opts)
}
