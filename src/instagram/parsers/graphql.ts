/**
 * GraphQL response parser — normalizes Instagram GraphQL API responses
 * into uniform ``ParsedPost`` structures.
 */

import type { InstagramPost, InstagramUser, ParsedMedia, ParsedPost, ParserConfig } from '../types'
import { shortcodeFromId } from '../../utils/id-codec'
import { extractTaggedUsers } from './rest'

/** Parse a GraphQL post/edge response. */

export function parsePostGraphql(
  post: Record<string, unknown>,
  cfg: ParserConfig,
): ParsedPost {
  const typename = (post.__typename as string) ?? 'GraphImage'
  const owner = post.owner as InstagramUser
  const date = cfg.parseTimestamp(post.taken_at_timestamp as number)

  const data: ParsedPost = {
    typename,
    likes: (post.edge_media_preview_like as { count: number } | undefined)?.count ?? 0,
    liked: (post.viewer_has_liked ?? false) as boolean,
    pinned: ((post.pinned_for_users as Array<{ id: string }> | undefined)?.map(u => Number(u.id)) ?? []) as unknown as string[],
    owner_id: owner.id ?? owner.pk,
    username: owner.username ?? '',
    fullname: owner.full_name ?? '',
    user: owner,
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

  const captionEdges = post.edge_media_to_caption as
    | { edges: Array<{ node: { text: string } }> } | undefined
  data.description = captionEdges?.edges?.map(e => e.node.text).join('\n') ?? ''
  data.description = parseUnicodeEscapes(data.description)

  const tags = cfg.findTags(data.description)
  if (tags.length > 0) {
    data.tags = [
      ...new Set(tags),
    ].sort()
  }

  const location = post.location as InstagramPost['location'] | undefined
  if (location) {
    data.location_id = location.pk
    data.location_slug = location.short_name
    data.location_url = `${cfg.root}/explore/locations/${location.pk}/${location.short_name}/`
  }

  const coauthors = post.coauthor_producers as InstagramUser[] | undefined
  if (coauthors?.length) {
    data.coauthors = coauthors.map(u => ({ id: u.id ?? u.pk, username: u.username }))
  }

  const sidecar = post.edge_sidecar_to_children as
    | { edges: Array<{ node: Record<string, unknown> }> } | undefined

  if (sidecar?.edges) {
    data.sidecar_media_id = data.post_id
    data.sidecar_shortcode = data.post_shortcode

    let num = 0
    for (const edge of sidecar.edges) {
      num++
      const node = edge.node
      const dimensions = node.dimensions as { width: number, height: number }
      const media: ParsedMedia = {
        num,
        date: data.date,
        media_id: node.id as string,
        shortcode: (node.shortcode as string) ?? shortcodeFromId(node.id as string),
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

function parseUnicodeEscapes(text: string): string {
  if (!text.includes('\\u'))
    return text
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
}
