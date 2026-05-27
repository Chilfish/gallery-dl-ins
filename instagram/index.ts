/**
 * Instagram module — public API surface.
 */

// API client
export { InstagramRestAPI } from './api'

// Base extractor
export { InstagramExtractor } from './base'
export type { InstagramExtractorOptions } from './base'

// Extractors
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
} from './extractors'

// Parsers
export { extractAudio, extractTaggedUsers, parsePostGraphql, parsePostRest } from './parsers'

// Types
export type {
  Coauthor,
  ImageCandidate,
  InstagramCarouselItem,
  InstagramLocation,
  InstagramPost,
  InstagramUser,
  ParsedMedia,
  ParsedPost,
  ParserConfig,
  TaggedUser,
  VideoVersion,
} from './types'
