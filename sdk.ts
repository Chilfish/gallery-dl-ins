/**
 * Platform-agnostic Instagram SDK — no Node.js / browser specific code.
 *
 * ```ts
 * import { InstagramSDK } from '@chilfish/gallery-dl-instagram/sdk'
 *
 * const instagram = new InstagramSDK({
 *   http: myHttpClient,     // your HttpClient implementation
 *   storage: myStorage,     // your Storage implementation (optional)
 *   log: myLogger,          // your Logger implementation (optional)
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
 * For the Node.js convenience factory with cookie-based setup, use the
 * main entry point:
 * ```ts
 * import { createSDK } from '@chilfish/gallery-dl-instagram'
 * const ig = await createSDK({ cookies: '...' })
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

// Re-export sub-extractor classes for type use
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
