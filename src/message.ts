/**
 * Message constructors and types.
 *
 * Simple factory functions so consumers never write raw message objects.
 */

import type {
  DirectoryMsg,
  ExtractorClass,
  Metadata,
  QueueMsg,
  UrlMsg,
} from './types'

// Re-export types for convenience
export type { Message, MessageIter } from './types'

export function directory(metadata: Metadata = {}): DirectoryMsg {
  return { type: 'directory', metadata }
}

export function url(u: string, metadata: Metadata = {}): UrlMsg {
  return { type: 'url', url: u, metadata }
}

export function queue(
  u: string,
  metadata: Metadata & { _extractor?: ExtractorClass } = {},
): QueueMsg {
  return { type: 'queue', url: u, metadata }
}
