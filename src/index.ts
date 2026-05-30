/**
 * gallery-dl-instagram — platform-agnostic Instagram media extractor SDK.
 *
 * ## Pure SDK (browser / Deno / Edge / Node.js)
 * ```ts
 * import { InstagramSDK } from '@chilfish/gallery-dl-instagram'
 * const ig = new InstagramSDK({ http: myHttpClient })
 * for await (const msg of ig.extract('https://www.instagram.com/p/ABC123/')) { ... }
 * ```
 *
 * ## Node.js convenience (native fetch + fs)
 * ```ts
 * import { createSDK } from '@chilfish/gallery-dl-instagram/node'
 * const ig = await createSDK({ cookies: 'ds_user_id=...; sessionid=...' })
 * await ig.download('https://www.instagram.com/p/ABC123/', './downloads')
 * ```
 */

// Config
export { ConfigManager } from './config'

// Core
export { Extractor } from './core/extractor'
export type { ExtractorOptions, Logger } from './core/extractor'
export { noopLogger } from './core/extractor'
export { Job } from './core/job'
export { DownloadJob } from './core/download-job'
export { PrintJob } from './core/print-job'

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
} from './instagram/extractors'

// Instagram
export * from './instagram/index'
// Message
export { directory, queue, url } from './message'

export type { MessageIter } from './message'

// SDK class (platform-agnostic)
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
