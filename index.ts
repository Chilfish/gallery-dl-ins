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

// Config
export { ConfigManager } from './config'
// Core
export { Extractor } from './core/extractor'
export type {
  ExtractorOptions,
  Logger,
} from './core/extractor'
export { noopLogger } from './core/extractor'

export { DownloadJob, Job } from './core/job'

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

// SDK (high-level)
export { InstagramSDK, createSDK } from './sdk'
export type { SDKOptions, ExtractOptions } from './sdk'

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
