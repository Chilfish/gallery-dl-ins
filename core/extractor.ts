/**
 * Base Extractor abstract class.
 *
 * Every extractor extends this.  The class provides:
 * - URL pattern matching via ``fromURL``
 * - One-time initialization guarded by ``initialize()``
 * - Async-iteration entrypoint ``[Symbol.asyncIterator]`` → ``items()``
 * - Rate-limited HTTP requests
 * - Timestamp parsing
 */

import type { ConfigManager } from '../config'
import type {
  ConfigValue,
  HttpClient,
  HttpResponse,
  MessageIter,
  RequestConfig,
  Storage,
} from '../types'

export interface ExtractorOptions {
  url: string
  match: RegExpMatchArray
  config: ConfigManager
  http: HttpClient
  storage: Storage
  /** The logger interface — at minimum a debug/info/warn/error contract */
  log: Logger
}

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

/** A no-op logger */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

export abstract class Extractor {
  /** Human-readable category (e.g. ``'instagram'``) */
  abstract readonly category: string

  /** Sub-category (e.g. ``'post'``, ``'posts'``, ``'reels'``) */
  abstract readonly subcategory: string

  /** Root URL (e.g. ``'https://www.instagram.com'``) */
  abstract readonly root: string

  /** Regex pattern to match against URLs */
  static readonly pattern: RegExp = /^$/

  /** The input URL */
  readonly url: string

  /** Regex match groups from ``fromURL`` */
  readonly groups: readonly string[]

  protected config: ConfigManager
  /** HTTP client — public so Job can access for downloads */
  readonly http: HttpClient
  /** Storage backend — public so Job can access for writes */
  readonly storage: Storage
  /** Logger instance — public so Job can access for reporting */
  readonly log: Logger

  /** Delay range in seconds — random between [min, max] before each request */
  protected requestInterval: [number, number] = [6, 12]

  private _initialized = false

  constructor(opts: ExtractorOptions) {
    this.url = opts.url
    this.groups = opts.match ? [...opts.match].slice(1) : []
    this.config = opts.config
    this.http = opts.http
    this.storage = opts.storage
    this.log = opts.log
  }

  /** Initialization */

  /**
   * One-time async setup (cookies, session, internal state).
   * Safe to call multiple times — after the first call it becomes a no-op.
   */
  async initialize(): Promise<void> {
    if (this._initialized)
      return
    await this._init()
    this._initialized = true
    // Replace with no-op so subclasses can call super.initialize() freely
    this.initialize = async () => {}
  }

  /**
   * Subclass hook for one-time setup.
   */
  protected async _init(): Promise<void> {
    // no-op by default
  }

  /** Async iteration */

  async* [Symbol.asyncIterator](): MessageIter {
    await this.initialize()
    yield* this.items()
  }

  /**
   * The main extraction pipeline.  Subclasses *must* implement this.
   */
  abstract items(): MessageIter

  /** Config helpers */

  /**
   * Read a config value using the interpolated hierarchy.
   */
  protected _cfg(key: string, defaultVal?: ConfigValue): ConfigValue | undefined {
    const path: readonly string[] = [
      'extractor',
      this.category,
      this.subcategory,
    ]
    return this.config.interpolate(path, key, defaultVal)
  }

  /** HTTP */

  private _lastRequestTime = 0

  /**
   * Rate-limited HTTP request wrapper.
   */
  async request(
    url: string,
    cfg: RequestConfig = {},
  ): Promise<HttpResponse<unknown>> {
    await this._throttle()
    const response = await this.http.request({ url, ...cfg })
    this._lastRequestTime = Date.now()
    return response
  }

  /**
   * Convenience: request + parse JSON body.
   */
  async requestJSON(
    url: string,
    cfg: RequestConfig = {},
  ): Promise<unknown> {
    const resp = await this.request(url, cfg)
    if (typeof resp.data === 'object')
      return resp.data
    try {
      return JSON.parse(resp.data as string)
    }
    catch {
      return {}
    }
  }

  /** Rate limiting */

  /**
   * Sleep long enough to keep the minimum interval between requests.
   */
  private async _throttle(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this._lastRequestTime
    const [min, max] = this.requestInterval
    // Random delay in milliseconds
    const target = min + Math.random() * (max - min)
    const waitMs = Math.max(0, target * 1000 - elapsed)
    if (waitMs > 0) {
      await new Promise(r => setTimeout(r, waitMs))
    }
  }

  /** Utility */

  /**
   * Convert a Unix timestamp (seconds or ms) to an ISO-8601 string.
   */
  parseTimestamp(ts: number | null | undefined): string {
    if (ts == null)
      return ''
    // If ts looks like milliseconds (year > 2100 in seconds)
    const asMs = ts > 2_500_000_000 ? ts : ts * 1000
    return new Date(asMs).toISOString()
  }

  /**
   * Generate a random hex token (used for CSRF).
   */
  static generateToken(size = 16): string {
    const bytes = new Uint8Array(size)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes)
    }
    else {
      // Fallback for Node without global crypto
      for (let i = 0; i < size; i++) {
        bytes[i] = Math.floor(Math.random() * 256)
      }
    }
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  }
}
