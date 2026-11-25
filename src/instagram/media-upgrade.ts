/**
 * Restore full-resolution images on posts whose candidate list was downscaled.
 *
 * REST ``media/info`` returns a trimmed ladder (1080px and below) while
 * ``original_width``/``original_height`` still describe the upload. The post
 * page ships the complete ladder, so the REST payload is patched in place when
 * the page offers a strictly larger image.
 */

import type { ImageCandidate, InstagramCarouselItem, InstagramPost } from './types'

/** Pick the largest candidate that shares the original aspect ratio. */
export function bestCandidate(
  candidates: readonly ImageCandidate[] | undefined,
  width?: number,
  height?: number,
): ImageCandidate | undefined {
  const sized = (candidates ?? []).filter(
    (c): c is ImageCandidate =>
      typeof c?.width === 'number'
      && typeof c?.height === 'number'
      && c.width > 0
      && c.height > 0,
  )
  if (sized.length === 0)
    return candidates?.[0]

  const targetWidth = width ?? 0
  const targetHeight = height ?? 0
  let pool = sized
  if (targetWidth > 0 && targetHeight > 0) {
    // Square crops sit in the same ladder; keep only the real frame.
    const ratio = targetWidth / targetHeight
    const matching = sized.filter(c => Math.abs(c.width / c.height - ratio) < 0.01)
    if (matching.length > 0)
      pool = matching
  }

  return pool.reduce((best, c) => (c.width * c.height > best.width * best.height
    ? c
    : best))
}

/**
 * Whether a media entry's candidate ladder tops out below its original size.
 *
 * Videos are skipped: their cover frame is always smaller than the video
 * resolution, and the page never offers a larger cover.
 */
export function isDownscaled(media: InstagramCarouselItem): boolean {
  if (media.media_type === 2)
    return false

  const width = media.original_width
  const height = media.original_height
  if (typeof width !== 'number' || typeof height !== 'number')
    return false

  const best = bestCandidate(media.image_versions2?.candidates, width, height)
  if (!best || typeof best.width !== 'number' || typeof best.height !== 'number')
    return false

  return best.width < width && best.height < height
}

/** Whether the post (or any carousel child) was served downscaled. */
export function needsUpgrade(post: InstagramPost): boolean {
  if (isDownscaled(post as unknown as InstagramCarouselItem))
    return true
  return (post.carousel_media ?? []).some(isDownscaled)
}

function candidateArea(media: InstagramCarouselItem): number {
  const best = bestCandidate(
    media.image_versions2?.candidates,
    media.original_width,
    media.original_height,
  )
  return best
    ? best.width * best.height
    : 0
}

/**
 * Patch ``post`` with the page's candidates where they are strictly larger.
 *
 * Carousel children are aligned by ``pk`` (falling back to their index). The
 * page payload omits video renditions worth keeping, so only image candidate
 * lists and original dimensions are copied.
 */
export function upgradeMedia(post: InstagramPost, page: InstagramPost | null): boolean {
  if (!page)
    return false

  let changed = applyUpgrade(
    post as unknown as InstagramCarouselItem,
    page as unknown as InstagramCarouselItem,
  )

  const pageChildren = page.carousel_media ?? []
  for (const [index, child] of (post.carousel_media ?? []).entries()) {
    const counterpart = pageChildren.find(c => c.pk === child.pk) ?? pageChildren[index]
    if (counterpart && applyUpgrade(child, counterpart))
      changed = true
  }

  return changed
}

function applyUpgrade(
  target: InstagramCarouselItem,
  source: InstagramCarouselItem,
): boolean {
  if (!isDownscaled(target))
    return false

  const sourceCandidates = source.image_versions2?.candidates
  if (!sourceCandidates?.length)
    return false

  if (candidateArea(source) <= candidateArea(target))
    return false

  target.image_versions2 = source.image_versions2
  if (typeof source.original_width === 'number')
    target.original_width = source.original_width
  if (typeof source.original_height === 'number')
    target.original_height = source.original_height
  return true
}
