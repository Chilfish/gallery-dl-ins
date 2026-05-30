/** Shared regex utilities for Instagram extractor URL patterns. */

export const BASE_RE = /^(?:https?:\/\/)?(?:www\.)?instagram\.com/

export function re(base: RegExp, path: RegExp | string): RegExp {
  const pathSrc = typeof path === 'string' ? path : path.source
  return new RegExp(base.source + pathSrc, 'i')
}
