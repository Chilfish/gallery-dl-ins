/**
 * Instagram post parsers — normalize raw API responses into a uniform
 * ``ParsedPost`` structure.
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
} from './types'
import { shortcodeFromId } from '../utils/id-codec'

// ---------------------------------------------------------------------------
// Main entry — REST
// ---------------------------------------------------------------------------

export function parsePostRest(
  post: InstagramPost,
  cfg: ParserConfig,
): ParsedPost {
  // ── Story or highlight (has top-level "items") ──
  if (post.items) {
    return parseStoryRest(post, cfg)
  }

  // ── Regular post / carousel ──
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

  // Description & tags
  const tags = cfg.findTags(data.description)
  if (tags.length > 0) {
    data.tags = [...new Set(tags)].sort()
  }

  // Location
  if (post.location) {
    const loc = post.location
    const slug = loc.short_name.replace(/\s+/g, '-').toLowerCase()
    data.location_id = loc.pk
    data.location_slug = slug
    data.location_url = `${cfg.root}/explore/locations/${loc.pk}/${slug}/`
  }

  // Coauthors
  if (post.coauthor_producers) {
    data.coauthors = post.coauthor_producers.map(u => ({
      id: u.pk,
      username: u.username,
      full_name: u.full_name,
    }))
  }

  // Determine items (carousel vs single)
  let items: readonly InstagramCarouselItem[]
  if (post.carousel_media?.length) {
    data.sidecar_media_id = data.post_id
    data.sidecar_shortcode = data.post_shortcode
    items = post.carousel_media
  }
  else {
    items = [post as unknown as InstagramCarouselItem]
  }

  // Parse each media item
  for (let num = 0; num < items.length; num++) {
    const item = items[num]!
    const media = parseMediaItem(item, post, cfg, num + 1)
    if (!media)
      continue

    const itemRec = item as unknown as Record<string, unknown>
    extractTaggedUsers(itemRec, media)
    data._files.push(media)

    // Story music stickers
    const stickers = itemRec.story_music_stickers as MusicSticker[] | undefined
    if (stickers?.[0]) {
      const audio = extractAudio(itemRec, data as unknown as Record<string, unknown>, stickers[0], cfg)
      if (audio) {
        audio.num = num + 1
        data._files.push(audio)
      }
    }
  }

  // Music metadata on the post itself
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

  // Set type & post URL
  const files = data._files
  if (files.length === 1 && files[0]!.video_url) {
    data.type = 'reel'
    data.post_url = `${cfg.root}/reel/${post.code}/`
  }

  // Subscription
  if (post.subscription_media_visibility) {
    data.subscription = post.subscription_media_visibility
  }

  return data
}

// ---------------------------------------------------------------------------
// Story / highlight
// ---------------------------------------------------------------------------

function parseStoryRest(post: InstagramPost, cfg: ParserConfig): ParsedPost {
  const items = post.items!
  const reelId = String(post.id).split(':').pop() ?? '0'

  const date = cfg.parseTimestamp(
    (post.taken_at ?? post.created_at ?? post.seen) ?? null,
  )

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

  if (!isStory) {
    if (post.title)
      data.highlight_title = post.title
  }
  else if (!post.seen) {
    post.seen = expires! - 86400
  }

  // Parse each frame
  for (let num = 0; num < items.length; num++) {
    const item = items[num]!
    const media = parseMediaItem(item, post, cfg, num + 1)
    if (!media)
      continue

    const itemRec = item as unknown as Record<string, unknown>
    extractTaggedUsers(itemRec, media)
    data._files.push(media)
  }

  return data
}

// ---------------------------------------------------------------------------
// Single media item
// ---------------------------------------------------------------------------

function parseMediaItem(
  item: InstagramCarouselItem,
  parent: InstagramPost,
  cfg: ParserConfig,
  num: number,
): ParsedMedia | null {
  // Image candidate
  let image: ImageCandidate
  try {
    image = item.image_versions2.candidates[0]!
  }
  catch {
    return null
  }

  const itemRec = item as unknown as Record<string, unknown>

  // Static video handling
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

  // Video
  let video: VideoVersion | null = null
  let manifest: string | null = null
  let width: number
  let height: number

  if (item.video_versions?.length) {
    video = item.video_versions.reduce((best, v) =>
      v.width * v.height * v.type > best.width * best.height * best.type
        ? v
        : best,
    )

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

  // Build media object
  const media: ParsedMedia = {
    num,
    date: cfg.parseTimestamp(
      (itemRec.taken_at as number)
      ?? (video as unknown as Record<string, number> | null)?.taken_at
      ?? parent.taken_at
      ?? null,
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

  if (manifest != null) {
    media._ytdl_manifest_data = manifest
  }
  if (item.owner)
    media.owner = item.owner
  if (item.reshared_story_media_author) {
    media.author = item.reshared_story_media_author
  }
  if (item.expiring_at != null) {
    media.expires = cfg.parseTimestamp(item.expiring_at)
  }
  if (item.subscription_media_visibility) {
    media.subscription = item.subscription_media_visibility
  }
  if (itemRec.audience) {
    media.audience = itemRec.audience as string
  }

  return media
}

// ---------------------------------------------------------------------------
// Tagged users
// ---------------------------------------------------------------------------

export function extractTaggedUsers(
  src: Record<string, unknown>,
  dest: ParsedMedia,
): void {
  dest.tagged_users = []

  // edge_media_to_tagged_user (GraphQL style)
  const edges = src.edge_media_to_tagged_user as
    | { edges: Array<{ node: { user: InstagramUser } }> }
    | undefined
  if (edges?.edges) {
    for (const edge of edges.edges) {
      const u = edge.node.user
      dest.tagged_users.push({
        id: u.id ?? u.pk,
        username: u.username,
        full_name: u.full_name,
      })
    }
  }

  // usertags.in (REST style)
  const usertags = src.usertags as
    | { in?: Array<{ user: InstagramUser }> }
    | undefined
  if (usertags?.in) {
    for (const tag of usertags.in) {
      const u = tag.user
      dest.tagged_users.push({
        id: u.pk,
        username: u.username,
        full_name: u.full_name,
      })
    }
  }

  // reel_mentions
  const mentions = src.reel_mentions as
    | Array<{ user: InstagramUser }>
    | undefined
  if (mentions) {
    for (const m of mentions) {
      const u = m.user
      dest.tagged_users.push({
        id: u.pk ?? u.id ?? '',
        username: u.username,
        full_name: u.full_name,
      })
    }
  }

  // story_bloks_stickers
  const bloks = src.story_bloks_stickers as
    | Array<{
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
    }>
    | undefined
  if (bloks) {
    for (const sticker of bloks) {
      const s = sticker.bloks_sticker
      if (s.bloks_sticker_type === 'mention') {
        const m = s.sticker_data.ig_mention
        dest.tagged_users.push({
          id: m.account_id,
          username: m.username,
          full_name: m.full_name,
        })
      }
    }
  }

  // Deduplicate by id
  const seen = new Set<string>()
  dest.tagged_users = dest.tagged_users.filter((t) => {
    if (seen.has(t.id))
      return false
    seen.add(t.id)
    return true
  })
}

// ---------------------------------------------------------------------------
// Audio / music extraction
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GraphQL parser
// ---------------------------------------------------------------------------

export function parsePostGraphql(
  post: Record<string, unknown>,
  cfg: ParserConfig,
): ParsedPost {
  const typename = (post.__typename as string) ?? 'GraphImage'

  const owner = post.owner as InstagramUser
  const date = cfg.parseTimestamp(post.taken_at_timestamp as number)

  const data: ParsedPost = {
    typename,
    likes:
      (post.edge_media_preview_like as { count: number } | undefined)?.count
      ?? 0,
    liked: (post.viewer_has_liked ?? false) as boolean,
    pinned: (
      (post.pinned_for_users as Array<{ id: string }> | undefined)?.map(
        u => Number(u.id),
      ) ?? []
    ) as unknown as string[],
    owner_id: owner.id ?? owner.pk,
    username: owner.username ?? '',
    fullname: owner.full_name ?? '',
    post_id: post.id as string,
    post_shortcode: post.shortcode as string,
    post_url: `${cfg.root}/p/${post.shortcode}/`,
    post_date: date,
    date,
    description: '',
    type: 'post',
    count: 0,
    _files: [],
  }

  // Description
  const captionEdges = post.edge_media_to_caption as
    | { edges: Array<{ node: { text: string } }> }
    | undefined
  data.description
    = captionEdges?.edges?.map(e => e.node.text).join('\n') ?? ''
  data.description = parseUnicodeEscapes(data.description)

  const tags = cfg.findTags(data.description)
  if (tags.length > 0)
    data.tags = [...new Set(tags)].sort()

  // Location
  const location = post.location as InstagramPost['location'] | undefined
  if (location) {
    data.location_id = location.pk
    data.location_slug = location.short_name
    data.location_url = `${cfg.root}/explore/locations/${location.pk}/${location.short_name}/`
  }

  // Coauthors
  const coauthors = post.coauthor_producers as InstagramUser[] | undefined
  if (coauthors?.length) {
    data.coauthors = coauthors.map(u => ({
      id: u.id ?? u.pk,
      username: u.username,
    }))
  }

  // Carousel vs single
  const sidecar = post.edge_sidecar_to_children as
    | { edges: Array<{ node: Record<string, unknown> }> }
    | undefined

  if (sidecar?.edges) {
    data.sidecar_media_id = data.post_id
    data.sidecar_shortcode = data.post_shortcode

    let num = 0
    for (const edge of sidecar.edges) {
      num++
      const node = edge.node
      const dimensions = node.dimensions as {
        width: number
        height: number
      }

      const media: ParsedMedia = {
        num,
        date: data.date,
        media_id: node.id as string,
        shortcode:
          (node.shortcode as string) ?? shortcodeFromId(node.id as string),
        display_url: node.display_url as string,
        video_url: (node.video_url as string) ?? null,
        width: dimensions.width,
        height: dimensions.height,
        sidecar_media_id: data.post_id,
        sidecar_shortcode: data.post_shortcode,
        tagged_users: [],
        width_original: dimensions.width,
        height_original: dimensions.height,
      }
      extractTaggedUsers(node, media)
      data._files.push(media)
    }
  }
  else {
    const dimensions = post.dimensions as { width: number, height: number }
    const media: ParsedMedia = {
      num: 1,
      date: data.date,
      media_id: post.id as string,
      shortcode: post.shortcode as string,
      display_url: post.display_url as string,
      video_url: (post.video_url as string) ?? null,
      width: dimensions.width,
      height: dimensions.height,
      tagged_users: [],
      width_original: dimensions.width,
      height_original: dimensions.height,
    }
    extractTaggedUsers(post, media)
    data._files.push(media)
  }

  return data
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPinned(post: InstagramPost): string[] {
  if (post.timeline_pinned_user_ids)
    return post.timeline_pinned_user_ids
  if (post.clips_tab_pinned_user_ids)
    return post.clips_tab_pinned_user_ids
  return []
}

function parseUnicodeEscapes(text: string): string {
  if (!text.includes('\\u'))
    return text
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)))
}
