/**
 * Instagram API & parsed-post type definitions.
 *
 * These mirror the actual JSON shapes returned by Instagram's internal API
 * (``/api/v1/…``).
 */

/** API response types */

export interface InstagramUser {
  pk: string
  id?: string
  username: string
  full_name: string
  is_private?: boolean
  profile_pic_url?: string
  profile_pic_url_hd?: string
  hd_profile_pic_url_info?: ImageCandidate
  hd_profile_pic_versions?: ImageCandidate[]
  profile_pic_id?: string
  edge_owner_to_timeline_media?: { count: number }
  edge_felix_video_timeline?: { count: number }
  edge_saved_media?: { count: number }
  edge_mutual_followed_by?: { count: number }
  edge_follow?: { count: number }
  edge_followed_by?: { count: number }
  edge_media_collections?: { count: number }
  followed_by_viewer?: boolean
  is_verified?: boolean
}

export interface ImageCandidate {
  url: string
  width: number
  height: number
}

export interface VideoVersion {
  url: string
  width: number
  height: number
  type: number
}

export interface InstagramLocation {
  pk: string
  short_name: string
}

export interface Caption {
  text: string
}

export interface UserTag {
  user: InstagramUser
}

export interface ReelMention {
  user: InstagramUser
}

export interface BloksSticker {
  bloks_sticker: {
    bloks_sticker_type: string
    sticker_data: {
      ig_mention: {
        account_id: string
        username: string
        full_name: string
      }
    }
  }
}

export interface MusicSticker {
  music_asset_info?: MusicAssetInfo
  music_consumption_info?: MusicConsumptionInfo
}

export interface MusicAssetInfo {
  id: string
  title?: string
  sanitized_title?: string
  subtitle?: string
  display_artist?: string
  ig_artist?: string
  ig_username?: string
  duration_in_ms?: number
  highlight_start_times_in_ms?: number[]
  progressive_download_url: string
  cover_artwork_uri?: string
  cover_artwork_thumbnail_uri?: string
  has_lyrics?: boolean
  is_explicit?: boolean
}

export interface MusicConsumptionInfo {
  display_artist?: string
  ig_artist?: string
}

export interface MusicMetadata {
  music_info?: MusicSticker
}

export interface InstagramPost {
  pk: string
  id?: string
  code: string
  caption: Caption | null
  taken_at: number
  created_at?: number
  like_count?: number
  has_liked?: boolean
  user: InstagramUser
  carousel_media?: InstagramCarouselItem[]
  image_versions2: { candidates: ImageCandidate[] }
  video_versions?: VideoVersion[]
  video_dash_manifest?: string
  original_width?: number
  original_height?: number
  media_type?: number
  original_media_type?: number
  location?: InstagramLocation
  coauthor_producers?: InstagramUser[]
  usertags?: { in: UserTag[] }
  reel_mentions?: ReelMention[]
  story_bloks_stickers?: BloksSticker[]
  story_music_stickers?: MusicSticker[]
  music_metadata?: MusicMetadata
  expiring_at?: number
  seen?: number
  items?: InstagramCarouselItem[]
  timeline_pinned_user_ids?: string[]
  clips_tab_pinned_user_ids?: string[]
  subscription_media_visibility?: string
  audience?: string
  title?: string
  pins?: unknown[]
}

export interface InstagramCarouselItem {
  pk: string
  id?: string
  code?: string
  taken_at?: number
  image_versions2: { candidates: ImageCandidate[] }
  video_versions?: VideoVersion[]
  video_dash_manifest?: string
  original_width?: number
  original_height?: number
  media_type?: number
  original_media_type?: number
  owner?: InstagramUser
  reshared_story_media_author?: InstagramUser
  expiring_at?: number
  subscription_media_visibility?: string
  audience?: string
  story_music_stickers?: MusicSticker[]
  usertags?: { in: UserTag[] }
  reel_mentions?: ReelMention[]
  story_bloks_stickers?: BloksSticker[]
}

/** Parsed post (normalized output) */

export interface ParsedPost {
  post_id: string
  post_shortcode: string
  post_url: string
  owner_id: string
  username: string
  fullname: string
  post_date: string
  date: string
  description: string
  tags?: string[]
  location_id?: string
  location_slug?: string
  location_url?: string
  likes: number
  liked: boolean
  pinned: string[]
  coauthors?: Coauthor[]
  sidecar_media_id?: string
  sidecar_shortcode?: string
  type: 'post' | 'reel' | 'story' | 'highlight'
  count: number
  _files: ParsedMedia[]
  user?: InstagramUser
  expires?: string
  highlight_title?: string
  tagged_owner_id?: string
  tagged_username?: string
  tagged_full_name?: string
  subscription?: string
  /** For graphql: */
  typename?: string
}

export interface ParsedMedia {
  num: number
  date: string
  media_id: string
  shortcode: string
  display_url: string
  video_url: string | null
  width: number
  width_original: number
  height: number
  height_original: number
  tagged_users: TaggedUser[]
  owner?: InstagramUser
  author?: InstagramUser
  expires?: string
  subscription?: string
  audience?: string
  audio_url?: string
  audio_user?: string
  audio_title?: string
  audio_subtitle?: string
  audio_artist?: string
  audio_duration?: number
  audio_timestamps?: number[]
  audio_cover_artwork_uri?: string
  audio_cover_artwork_thumbnail_uri?: string
  audio_has_lyrics?: boolean
  audio_is_explicit?: boolean
  _ytdl_manifest_data?: string
  sidecar_media_id?: string
  sidecar_shortcode?: string
}

export interface Coauthor {
  id: string
  username: string
  full_name?: string
}

export interface TaggedUser {
  id: string
  username: string
  full_name: string
}

/** Parser config */

export interface ParserConfig {
  root: string
  findTags: (text: string) => string[]
  parseTimestamp: (ts: number | null | undefined) => string
  staticVideo: boolean
  warnVideo: boolean
  warnImage: number
  videosDash: boolean
}
