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
  /** Flat counters returned by the doc_id profile query. */
  follower_count?: number
  following_count?: number
  media_count?: number
  biography?: string
  external_url?: string
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
  /** Text attribution (e.g. "Sticker by 前島亜美"). */
  attribution?: string
  /** Display type (e.g. "music_hidden", "music_with_lyrics"). */
  display_type?: string
  /** Placement on story canvas (0-1 fractional). */
  x?: number
  y?: number
  width?: number
  height?: number
  rotation?: number
  start_time_ms?: number
  end_time_ms?: number
}

/** A link sticker on a story (swipe-up / CTA link). */
export interface StoryLink {
  display_url: string
  link_title: string
  link_type: string
  url: string
}

export interface StoryLinkSticker {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  start_time_ms: number
  end_time_ms: number
  story_link: StoryLink
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
  /** Lower-bitrate alternative download URL. */
  fast_start_progressive_download_url?: string
  cover_artwork_uri?: string
  cover_artwork_thumbnail_uri?: string
  has_lyrics?: boolean
  is_explicit?: boolean
  /** Profile picture placeholder for the artist. */
  placeholder_profile_pic_url?: string
  /** Audio asset ID (differs from ``id`` which is the track ID). */
  audio_asset_id?: string
  /** Where in the track the playback starts (ms). */
  audio_asset_start_time_in_ms?: number
  /** How long the music overlaps with the video. */
  overlap_duration_in_ms?: number
  /** Music cluster ID for trending / recommendations. */
  audio_cluster_id?: string
  /** Artist ID in Instagram's music catalog. */
  artist_id?: string
  /** Whether the track is trending in Reels. */
  is_trending_in_clips?: boolean
  /** Whether the user has bookmarked this track. */
  is_bookmarked?: boolean
  /** Licensing subtype (e.g. "DEFAULT"). */
  licensed_music_subtype?: string
  /** Whether media creation with this music is allowed. */
  allow_media_creation_with_music?: boolean
  /** Whether saving/downloading the audio is allowed. */
  allows_saving?: boolean
  /** Audio muting configuration. */
  audio_muting_info?: {
    mute_audio: boolean
    mute_reason_str: string
    allow_audio_editing: boolean
    show_muted_audio_toast: boolean
  }
  /** Whether audio should be muted and why. */
  should_mute_audio?: boolean
  should_mute_audio_reason?: string
  should_mute_audio_reason_type?: string | null
  /** Whether to render the soundwave visual. */
  should_render_soundwave?: boolean
  /** Reactive/streaming audio download URL (may be null). */
  reactive_audio_download_url?: string | null
  /** 30-second web preview download URL. */
  web_30s_preview_download_url?: string | null
  /** Monetization info for the song. */
  song_monetization_info?: unknown
  /** Trend rank info (current and previous). */
  trend_rank?: unknown
  previous_trend_rank?: unknown
  /** Display labels for the track. */
  display_labels?: unknown
  /** Related derived content. */
  derived_content_id?: string | null
  derived_content_start_time_in_composition_in_ms?: number | null
  /** Number of clips that use this music. */
  formatted_clips_media_count?: unknown
  /** Eligibility for vinyl sticker / audio effects. */
  is_eligible_for_audio_effects?: unknown
  is_eligible_for_vinyl_sticker?: boolean
  /** Audio filter configurations. */
  audio_filter_infos?: unknown[]
  /** Lyrics data (if available). */
  lyrics?: unknown
  /** Spotify track metadata (if linked). */
  spotify_track_metadata?: unknown
  /** User notes on the track. */
  user_notes?: unknown
  /** Related audio recommendations. */
  related_audios?: unknown
  /** Dark mode message override. */
  dark_message?: unknown
  /** DASH manifest for audio. */
  dash_manifest?: unknown
  /** Music creation restriction reason. */
  music_creation_restriction_reason?: unknown
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
  story_link_stickers?: StoryLinkSticker[]
  music_metadata?: MusicMetadata
  highlights_info?: { added_to: Array<{ reel_id: string, title: string }> }
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
  story_link_stickers?: StoryLinkSticker[]
  usertags?: { in: UserTag[] }
  reel_mentions?: ReelMention[]
  story_bloks_stickers?: BloksSticker[]
}

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
  /** Story link sticker data. */
  story_link_url?: string
  story_link_display?: string
  story_link_title?: string
  story_link_type?: string
  /** Music sticker attribution (e.g. "Sticker by 前島亜美"). */
  music_attribution?: string
  /** Music sticker display type (e.g. "music_hidden"). */
  music_display_type?: string
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
