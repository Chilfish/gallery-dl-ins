/**
 * REST response parsers — normalize Instagram REST API responses into
 * uniform ``ParsedPost`` structures.
 */

import type {
  ImageCandidate,
  InstagramCarouselItem,
  InstagramPost,
  InstagramUser,
  MusicSticker,
  ParsedMedia,
  ParsedPost,
  ParserConfig,
  VideoVersion,
} from '../types'
import { shortcodeFromId } from '../../utils/id-codec'

/** Main entry — parse a REST post response. */

export function parsePostRest(
  post: InstagramPost,
  cfg: ParserConfig,
): ParsedPost {
  if (post.items)
    return parseStoryRest(post, cfg)

  const owner = post.user
  const caption = post.caption
  const ts = post.taken_at ?? post.created_at
  const date = cfg.parseTimestamp(ts ?? null)

  const data: ParsedPost = {
    post_id: post.pk,
    post_shortcode: post.code,
    post_url: `${cfg.root}/p/${post.code}/`,
    likes: post.like_count ?? 0,
    liked: post.has_liked ?? false,
    pinned: extractPinned(post),
    owner_id: owner.pk,
    username: owner.username ?? '',
    fullname: owner.full_name ?? '',
    post_date: date,
    date,
    description: caption ? caption.text : '',
    type: 'post',
    count: 0,
    _files: [],
  }

  const tags = cfg.findTags(data.description)
  if (tags.length > 0)
    data.tags = [...new Set(tags)].sort()

  if (post.location) {
    const loc = post.location
    data.location_id = loc.pk
    data.location_slug = loc.short_name.replace(/\s+/g, '-').toLowerCase()
    data.location_url = `${cfg.root}/explore/locations/${loc.pk}/${data.location_slug}/`
  }

  if (post.coauthor_producers) {
    data.coauthors = post.coauthor_producers.map(u => ({
      id: u.pk,
      username: u.username,
      full_name: u.full_name,
    }))
  }

  let items: readonly InstagramCarouselItem[]
  if (post.carousel_media?.length) {
    data.sidecar_media_id = data.post_id
    data.sidecar_shortcode = data.post_shortcode
    items = post.carousel_media
  }
  else {
    items = [post as unknown as InstagramCarouselItem]
  }

  for (let num = 0; num < items.length; num++) {
    const item = items[num]!
    const media = parseMediaItem(item, post, cfg, num + 1)
    if (!media)
      continue

    const itemRec = item as unknown as Record<string, unknown>
    extractTaggedUsers(itemRec, media)
    data._files.push(media)

    const stickers = itemRec.story_music_stickers as MusicSticker[] | undefined
    if (stickers?.[0]) {
      const audio = extractAudio(itemRec, data as unknown as Record<string, unknown>, stickers[0], cfg)
      if (audio) {
        audio.num = num + 1
        data._files.push(audio)
      }
    }
  }

  if (post.music_metadata) {
    const info = post.music_metadata.music_info
    if (info) {
      const audio = extractAudio(
        post as unknown as Record<string, unknown>,
        data as unknown as Record<string, unknown>,
        { music_asset_info: info },
        cfg,
      )
      if (audio) {
        audio.num = items.length
        data._files.push(audio)
      }
    }
  }

  const files = data._files
  if (files.length === 1 && files[0]!.video_url) {
    data.type = 'reel'
    data.post_url = `${cfg.root}/reel/${post.code}/`
  }

  if (post.subscription_media_visibility)
    data.subscription = post.subscription_media_visibility

  return data
}

/** Parse a story or highlight REST response. */

function parseStoryRest(post: InstagramPost, cfg: ParserConfig): ParsedPost {
  const items = post.items!
  const reelId = String(post.id).split(':').pop() ?? '0'
  const date = cfg.parseTimestamp((post.taken_at ?? post.created_at ?? post.seen) ?? null)
  const expires = post.expiring_at
  const isStory = !!expires

  const data: ParsedPost = {
    post_id: reelId,
    post_shortcode: shortcodeFromId(reelId),
    post_url: isStory
      ? `${cfg.root}/stories/${post.user.username}/`
      : `${cfg.root}/stories/highlights/${reelId}/`,
    likes: 0,
    liked: false,
    pinned: [],
    owner_id: post.user.pk,
    username: post.user.username ?? '',
    fullname: post.user.full_name ?? '',
    post_date: date,
    date,
    description: '',
    type: isStory ? 'story' : 'highlight',
    count: 0,
    _files: [],
    expires: expires ? cfg.parseTimestamp(expires) : undefined,
    user: post.user,
  }

  if (!isStory && post.title)
    data.highlight_title = post.title
  else if (!post.seen)
    post.seen = expires! - 86400

  for (let num = 0; num < items.length; num++) {
    const item = items[num]!
    const media = parseMediaItem(item, post, cfg, num + 1)
    if (!media)
      continue
    extractTaggedUsers(item as unknown as Record<string, unknown>, media)
    data._files.push(media)
  }

  return data
}

/** Parse a single media item (image/video) from a carousel or story. */

function parseMediaItem(
  item: InstagramCarouselItem,
  parent: InstagramPost,
  cfg: ParserConfig,
  num: number,
): ParsedMedia | null {
  let image: ImageCandidate
  try {
    image = item.image_versions2.candidates[0]!
  }
  catch {
    return null
  }

  const itemRec = item as unknown as Record<string, unknown>

  if (
    !cfg.staticVideo
    && item.original_media_type != null
    && item.original_media_type === 1
    && item.original_media_type !== item.media_type
  ) {
    delete itemRec.video_versions
    if (image) {
      item.original_width = image.width
      item.original_height = image.height
    }
  }

  const widthOrig = item.original_width ?? 0
  const heightOrig = item.original_height ?? 0

  let video: VideoVersion | null = null
  let manifest: string | null = null
  let width: number
  let height: number

  if (item.video_versions?.length) {
    video = item.video_versions.reduce((best, v) =>
      v.width * v.height * v.type > best.width * best.height * best.type ? v : best)
    if (item.video_dash_manifest && cfg.videosDash) {
      manifest = item.video_dash_manifest
      width = widthOrig
      height = heightOrig
    }
    else {
      width = video.width
      height = video.height
    }
  }
  else {
    video = null
    manifest = null
    width = image.width
    height = image.height
  }

  const media: ParsedMedia = {
    num,
    date: cfg.parseTimestamp(
      (itemRec.taken_at as number)
      ?? (video as unknown as Record<string, number> | null)?.taken_at
      ?? parent.taken_at ?? null,
    ),
    media_id: item.pk,
    shortcode: item.code ?? shortcodeFromId(item.pk),
    display_url: image.url,
    video_url: video?.url ?? null,
    width,
    width_original: widthOrig,
    height,
    height_original: heightOrig,
    tagged_users: [],
  }

  if (manifest != null)
    media._ytdl_manifest_data = manifest
  if (item.owner)
    media.owner = item.owner
  if (item.reshared_story_media_author)
    media.author = item.reshared_story_media_author
  if (item.expiring_at != null)
    media.expires = cfg.parseTimestamp(item.expiring_at)
  if (item.subscription_media_visibility)
    media.subscription = item.subscription_media_visibility
  if (itemRec.audience)
    media.audience = itemRec.audience as string

  return media
}

/** Extract tagged users from various field formats. */

export function extractTaggedUsers(
  src: Record<string, unknown>,
  dest: ParsedMedia,
): void {
  dest.tagged_users = []

  const edges = src.edge_media_to_tagged_user as
    | { edges: Array<{ node: { user: InstagramUser } }> } | undefined
  if (edges?.edges) {
    for (const edge of edges.edges) {
      const u = edge.node.user
      dest.tagged_users.push({ id: u.id ?? u.pk, username: u.username, full_name: u.full_name })
    }
  }

  const usertags = src.usertags as { in?: Array<{ user: InstagramUser }> } | undefined
  if (usertags?.in) {
    for (const tag of usertags.in) {
      const u = tag.user
      dest.tagged_users.push({ id: u.pk, username: u.username, full_name: u.full_name })
    }
  }

  const mentions = src.reel_mentions as Array<{ user: InstagramUser }> | undefined
  if (mentions) {
    for (const m of mentions) {
      const u = m.user
      dest.tagged_users.push({ id: u.pk ?? u.id ?? '', username: u.username, full_name: u.full_name })
    }
  }

  const bloks = src.story_bloks_stickers as Array<{
    bloks_sticker: { bloks_sticker_type: string, sticker_data: { ig_mention: { account_id: string, username: string, full_name: string } } }
  }> | undefined
  if (bloks) {
    for (const sticker of bloks) {
      const s = sticker.bloks_sticker
      if (s.bloks_sticker_type === 'mention') {
        const m = s.sticker_data.ig_mention
        dest.tagged_users.push({ id: m.account_id, username: m.username, full_name: m.full_name })
      }
    }
  }

  const seen = new Set<string>()
  dest.tagged_users = dest.tagged_users.filter(t => seen.has(t.id) ? false : (seen.add(t.id), true))
}

/** Extract audio/music metadata from a story sticker. */

export function extractAudio(
  src: Record<string, unknown>,
  dest: Record<string, unknown>,
  sticker: MusicSticker,
  cfg: ParserConfig,
): ParsedMedia | null {
  const info = sticker.music_asset_info
  if (!info)
    return null

  const cinfo = sticker.music_consumption_info ?? info
  dest.audio_title = info.title
  dest.audio_duration = (info.duration_in_ms ?? 0) / 1000
  dest.audio_timestamps = info.highlight_start_times_in_ms
  dest.audio_artist = info.display_artist ?? cinfo.display_artist
  dest.audio_user = info.ig_artist ?? cinfo.ig_artist

  const url = info.progressive_download_url
  if (!url)
    return null

  return {
    num: 0,
    date: cfg.parseTimestamp((src.taken_at as number) ?? null),
    media_id: info.id,
    shortcode: shortcodeFromId(info.id),
    display_url: info.cover_artwork_uri ?? '',
    video_url: null,
    audio_url: url,
    width: 0,
    width_original: 0,
    height: 0,
    height_original: 0,
    tagged_users: [],
    audio_user: (info.ig_artist ?? cinfo.ig_artist) as string,
    audio_title: info.title,
    audio_artist: (info.display_artist ?? cinfo.display_artist) as string,
    audio_duration: (info.duration_in_ms ?? 0) / 1000,
    audio_timestamps: info.highlight_start_times_in_ms,
  }
}

function extractPinned(post: InstagramPost): string[] {
  if (post.timeline_pinned_user_ids)
    return post.timeline_pinned_user_ids
  if (post.clips_tab_pinned_user_ids)
    return post.clips_tab_pinned_user_ids
  return []
}
