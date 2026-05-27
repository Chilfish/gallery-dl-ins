/**
 * Shared type definitions for the gallery-dl TypeScript port.
 *
 * Message types form a discriminated union — the `type` tag determines
 * which handler a Job should invoke.
 */

/** HTTP abstraction */

export interface RequestConfig {
  headers?: Record<string, string>
  params?: Record<string, string | number | null | undefined>
  method?: string
  data?: unknown
  timeout?: number
  signal?: AbortSignal
  /** WithCredentials / CORS cookie passthrough for browsers */
  withCredentials?: boolean
  /** For binary downloads — 'arraybuffer' returns raw bytes */
  responseType?: 'arraybuffer' | 'text' | 'json'
}

export interface HttpResponse<T = unknown> {
  status: number
  data: T
  headers: Record<string, string>
  /** Final URL after redirects */
  url: string
  request?: RequestConfig
}

export interface HttpClient {
  request: <T = unknown>(config: {
    url: string
    method?: string
    headers?: Record<string, string>
    params?: Record<string, string | number | null | undefined>
    data?: unknown
    signal?: AbortSignal
    timeout?: number
    responseType?: 'arraybuffer' | 'text' | 'json'
  }) => Promise<HttpResponse<T>>
}

/** Storage abstraction */

export interface Storage {
  exists: (path: string) => Promise<boolean>
  write: (path: string, data: Uint8Array | string) => Promise<void>
  mkdir: (path: string) => Promise<void>
}

export type ConfigValue
  = | string
    | number
    | boolean
    | null
    | ConfigValue[]
    | { [key: string]: ConfigValue }

export interface Config { [key: string]: ConfigValue }

/** Metadata & messages */

/**
 * Flat string-keyed metadata dictionary.
 * In gallery-dl every kwdict is a plain `{string → value}` map.
 */
export type Metadata = Record<string, unknown>

export interface DirectoryMsg {
  readonly type: 'directory'
  readonly metadata: Metadata
}

export interface UrlMsg {
  readonly type: 'url'
  readonly url: string
  readonly metadata: Metadata
}

export interface QueueMsg {
  readonly type: 'queue'
  readonly url: string
  readonly metadata: Metadata & {
    readonly _extractor?: ExtractorClass
  }
}

export type Message = DirectoryMsg | UrlMsg | QueueMsg

/**
 * Async generator that yields Message values.
 */
export type MessageIter = AsyncGenerator<Message, void, unknown>

/** Extractor class reference (for Queue dispatch) */

/**
 * Minimal shape that every Extractor class must expose so the Dispatch
 * logic can re-instantiate from a URL.
 */
export interface ExtractorClass {
  fromURL: (url: string) => Extractor | null
  subcategory: string
}

// Pre-declare the Extractor interface to avoid circular refs
export interface Extractor {
  readonly category: string
  readonly subcategory: string
  readonly root: string
  initialize: () => Promise<void>
  [Symbol.asyncIterator]: () => MessageIter
}
