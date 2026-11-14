/**
 * Extract story reel data embedded in Instagram page HTML.
 *
 * Instagram server-renders some routes into ``<script type="application/json"
 * data-sjs>`` blocks. When the REST ``reels_media`` endpoint is unavailable,
 * the stories page payload is a reliable fallback — it contains
 * ``xdt_api__v1__feed__reels_media.reels_media`` with all items.
 */

import type { InstagramPost } from './types'

const REELS_KEY = 'xdt_api__v1__feed__reels_media'

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
  const own = rec[REELS_KEY]
  if (own && typeof own === 'object' && !Array.isArray(own))
    return own as Record<string, unknown>

  for (const value of Object.values(rec)) {
    const found = findReelsContainer(value, depth + 1)
    if (found)
      return found
  }
  return null
}

/**
 * Parse the stories page HTML for embedded reel data.
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

    const reels = container.reels_media
    if (Array.isArray(reels))
      return reels as InstagramPost[]
  }

  return null
}
