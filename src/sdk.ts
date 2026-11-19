/**
 * InstagramSDK — platform-agnostic Instagram media extraction.
 *
 * Pure SDK class that only depends on platform-agnostic interfaces.
 * For Node.js convenience (cookies → HttpClient), use ``createSDK()`` from ``./node``.
 *
 * ```ts
 * import { InstagramSDK } from '@chilfish/gallery-dl-instagram'
 * const ig = new InstagramSDK({ http: myHttpClient })
 * for await (const msg of ig.extract('https://www.instagram.com/p/ABC123/')) { ... }
 * ```
 */

import type { Extractor, Logger } from './core/extractor'
import type { HttpClient, MessageIter, Storage } from './types'
import { ConfigManager } from './config'
import { DownloadJob } from './core/download-job'
import { noopLogger } from './core/extractor'
import { createFetchHttpClient } from './fetcher'

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

export interface SDKOptions {
  /**
   * Custom HttpClient implementation.
   * Defaults to a platform-agnostic fetch-based client when omitted.
   */
  http?: HttpClient

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
    http?: HttpClient
    storage?: Storage
    log?: Logger
    csrfToken?: string
  } = {}) {
    this.http = opts.http ?? createFetchHttpClient()
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
    if (!this.storage) {
      throw new Error(
        'download() requires a Storage implementation — '
        + 'pass { storage } to the constructor (use createSDK() from "@chilfish/gallery-dl-instagram/node" for fs output).',
      )
    }

    const extractor = this._resolve(url)
    const job = new DownloadJob(extractor as Extractor)
    job.basePath = outputDir

    await job.run()

    const stats = job.stats
    return {
      posts: stats.posts,
      files: stats.files,
      bytes: stats.bytes,
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
        const inst = Reflect.construct(Cls, [
          {
            url,
            match,
            config: this.config,
            http: this.http,
            storage: this.storage,
            log: this.log,
            csrfToken: this._csrfToken,
          },
        ])
        return inst as Extractor
      }
    }

    throw new Error(
      `No extractor matched URL: ${url}. `
      + 'Supported: /p/, /reel/, /{user}/, /stories/, /highlights/, /explore/tags/, /saved/',
    )
  }
}
