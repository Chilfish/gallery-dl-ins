/**
 * Extract story / highlight reel data embedded in Instagram page HTML.
 *
 * Instagram server-renders some routes into ``<script type="application/json"
 * data-sjs>`` blocks. When the REST ``reels_media`` endpoint is unavailable,
 * the page payload is a reliable fallback.
 *
 * Two shapes are in use:
 * - stories page: ``xdt_api__v1__feed__reels_media.reels_media``
 * - highlights page: ``xdt_api__v1__feed__reels_media__connection.edges[].node``
 */

import type { InstagramPost } from './types'

const REELS_KEY = 'xdt_api__v1__feed__reels_media'
const REELS_CONNECTION_KEY = 'xdt_api__v1__feed__reels_media__connection'
const TIMELINE_KEY = 'xdt_api__v1__feed__user_timeline_graphql_connection'
const POST_KEY = 'xdt_api__v1__media__shortcode__web_info'
const POST_KEY_ANON = 'xig_polaris_media'

/** Narrow an unknown value to a plain object (arrays excluded). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function findReelsContainer(
  node: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 30 || node == null || typeof node !== 'object')
    return null

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findReelsContainer(item, depth + 1)
      if (found)
        return found
    }
    return null
  }

  const rec = node as Record<string, unknown>

  const direct = asRecord(rec[REELS_KEY])
  if (direct && Array.isArray(direct.reels_media))
    return direct

  const connection = asRecord(rec[REELS_CONNECTION_KEY])
  if (connection && Array.isArray(connection.edges))
    return connection

  for (const value of Object.values(rec)) {
    const found = findReelsContainer(value, depth + 1)
    if (found)
      return found
  }
  return null
}

/** Normalize either payload shape into the reel array. */
function reelsFromContainer(
  container: Record<string, unknown>,
): InstagramPost[] | null {
  if (Array.isArray(container.reels_media))
    return container.reels_media as InstagramPost[]

  if (Array.isArray(container.edges)) {
    const reels = container.edges
      .map(edge => asRecord(asRecord(edge)?.node))
      .filter((node): node is Record<string, unknown> => node !== null)
    return reels as unknown as InstagramPost[]
  }

  return null
}

/**
 * Parse a stories / highlights page for embedded reel data.
 *
 * Returns ``null`` when no payload is present (e.g. an error/login shell), or
 * the reel array when the payload exists — possibly empty when there is no
 * active story.
 */
export function extractReelsMediaFromPage(
  html: string,
): InstagramPost[] | null {
  if (!html.includes('data-sjs') || !html.includes(REELS_KEY))
    return null

  for (const block of html.matchAll(/<script[^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/g)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block[1] ?? '')
    }
    catch {
      continue
    }

    const container = findReelsContainer(parsed)
    if (!container)
      continue

    const reels = reelsFromContainer(container)
    if (reels)
      return reels
  }

  return null
}

/**
 * Find the profile posts connection embedded in a profile page.
 *
 * Crawler / logged-out variants server-render the first page as
 * ``xdt_api__v1__feed__user_timeline_graphql_connection.edges`` or
 * ``profile_grid_items``. Logged-in shells usually carry no posts.
 */
function findTimelineContainer(
  node: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 40 || node == null || typeof node !== 'object')
    return null

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findTimelineContainer(item, depth + 1)
      if (found)
        return found
    }
    return null
  }

  const rec = node as Record<string, unknown>

  const direct = asRecord(rec[TIMELINE_KEY])
  if (direct && Array.isArray(direct.edges))
    return direct

  if (Array.isArray(rec.profile_grid_items))
    return { profile_grid_items: rec.profile_grid_items }

  for (const value of Object.values(rec)) {
    const found = findTimelineContainer(value, depth + 1)
    if (found)
      return found
  }
  return null
}

/**
 * Parse a profile page for embedded post data.
 *
 * Returns ``null`` when the page has no usable payload (e.g. the logged-in
 * SSR-disabled shell), or the post array when it does.
 */
export function extractUserTimelineFromPage(
  html: string,
): InstagramPost[] | null {
  if (
    !html.includes('data-sjs')
    && !html.includes(TIMELINE_KEY)
    && !html.includes('profile_grid_items')
  ) {
    return null
  }

  for (const block of html.matchAll(/<script[^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/g)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block[1] ?? '')
    }
    catch {
      continue
    }

    const container = findTimelineContainer(parsed)
    if (!container)
      continue

    if (Array.isArray(container.edges)) {
      const posts = container.edges
        .map(edge => asRecord(asRecord(edge)?.node))
        .filter((node): node is Record<string, unknown> => node !== null)
      return posts as unknown as InstagramPost[]
    }

    if (Array.isArray(container.profile_grid_items))
      return container.profile_grid_items as InstagramPost[]
  }

  return null
}

/**
 * Find the single-post container embedded in a post page.
 *
 * Two shapes are in use: the logged-in shell carries
 * ``xdt_api__v1__media__shortcode__web_info.items[0]``; the logged-out shell
 * carries ``xig_polaris_media`` whose media node sits under
 * ``if_not_gated_logged_out`` (falling back to the wrapper itself).
 */
function findPostContainer(
  node: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 60 || node == null || typeof node !== 'object')
    return null

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findPostContainer(item, depth + 1)
      if (found)
        return found
    }
    return null
  }

  const rec = node as Record<string, unknown>

  const direct = asRecord(rec[POST_KEY])
  if (Array.isArray(direct?.items)) {
    const item = asRecord(direct.items[0])
    if (item)
      return item
  }

  const anon = rec[POST_KEY_ANON]
  if (anon != null) {
    const wrapper = asRecord(anon)
    const media = asRecord(wrapper?.if_not_gated_logged_out) ?? wrapper
    if (media && asRecord(media.image_versions2))
      return media
  }

  for (const value of Object.values(rec)) {
    const found = findPostContainer(value, depth + 1)
    if (found)
      return found
  }
  return null
}

/**
 * Fill in dimensions for candidates that only carry a ``url``.
 *
 * The logged-out payload omits ``width``/``height`` on every candidate; the
 * first one is the un-downscaled original, so seed it from
 * ``original_width``/``original_height``. Remaining candidates stay sizeless
 * and are ignored by size comparisons.
 */
function seedCandidateDimensions(
  media: Record<string, unknown>,
): void {
  const versions = asRecord(media.image_versions2)
  const candidates = Array.isArray(versions?.candidates)
    ? versions.candidates
    : []
  const first = asRecord(candidates[0])
  if (!first || typeof first.width === 'number')
    return

  const width = media.original_width
  const height = media.original_height
  if (typeof width === 'number' && typeof height === 'number') {
    first.width = width
    first.height = height
  }
}

/**
 * Parse a single-post page for its embedded media node.
 *
 * Returns ``null`` when the page carries no payload (error shell, or a
 * logged-in response that was served without SSR data).
 */
export function extractMediaFromPage(
  html: string,
): Record<string, unknown> | null {
  if (!html.includes('data-sjs'))
    return null

  for (const block of html.matchAll(/<script[^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/g)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block[1] ?? '')
    }
    catch {
      continue
    }

    const media = findPostContainer(parsed)
    if (!media)
      continue

    seedCandidateDimensions(media)
    if (Array.isArray(media.carousel_media)) {
      for (const child of media.carousel_media) {
        const rec = asRecord(child)
        if (rec)
          seedCandidateDimensions(rec)
      }
    }
    return media
  }

  return null
}
