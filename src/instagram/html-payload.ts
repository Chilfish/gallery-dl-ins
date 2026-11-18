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
