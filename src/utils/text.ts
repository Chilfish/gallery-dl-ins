/**
 * Text utilities ported from gallery-dl's ``text`` module.
 *
 * All functions are pure and environment-agnostic.
 */

/** String extraction */

/**
 * Extract the substring between ``begin`` and ``end`` from ``txt``.
 * Returns the substring or ``null`` if either delimiter is missing.
 */
export function extract(
  txt: string,
  begin: string,
  end: string,
): string | null {
  const first = txt.indexOf(begin)
  if (first < 0)
    return null
  const start = first + begin.length
  const last = txt.indexOf(end, start)
  if (last < 0)
    return null
  return txt.slice(start, last)
}

/**
 * Shorthand: same as ``extract`` but returns ``default_`` on failure.
 * Mirrors the Python ``extr()`` function.
 */
export function extr(
  txt: string,
  begin: string,
  end: string,
  default_ = '',
): string {
  return extract(txt, begin, end) ?? default_
}

/** Unicode / HTML */

/**
 * Decode ``\\uXXXX`` escape sequences in a string.
 */
export function parseUnicodeEscapes(text: string): string {
  if (!text.includes('\\u'))
    return text
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)))
}

/**
 * HTML entity decode.
 *
 * In Node.js we could use a DOM parser, but since this library is
 * environment-agnostic we ship a minimal covering the common cases.
 */
const HTML_ENTITIES: Record<string, string> = {
  'amp': '&',
  'lt': '<',
  'gt': '>',
  'quot': '"',
  'apos': '\'',
  'nbsp': '\u00A0',
  '#x27': '\'',
  '#x2F': '/',
  '#39': '\'',
  '#47': '/',
}

const RE_ENTITY = /&([^;]+);/g

export function unescape(text: string): string {
  return text.replace(RE_ENTITY, (m, name) => {
    const ch = HTML_ENTITIES[name]
    if (ch !== undefined)
      return ch
    // Numeric entities like &#123;
    if (name.startsWith('#')) {
      const cp = name[1] === 'x' || name[1] === 'X'
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10)
      if (Number.isSafeInteger(cp))
        return String.fromCodePoint(cp)
    }
    return m // leave unrecognized as-is
  })
}

/** URL helpers */

/**
 * URL-decode a string.
 */
export function unquote(text: string): string {
  try {
    return decodeURIComponent(text)
  }
  catch {
    // Best-effort: replace invalid sequences
    return text.replace(/%[0-9a-f]{2}/gi, (m) => {
      try {
        return decodeURIComponent(m)
      }
      catch {
        return m
      }
    })
  }
}

/**
 * Ensure a URL starts with ``https://`` (or ``http://``).
 */
export function ensureHttpScheme(url: string, scheme = 'https://'): string {
  if (!url)
    return url
  if (url.startsWith('https://') || url.startsWith('http://'))
    return url
  return scheme + url.replace(/^[/:]+/, '')
}

/**
 * Extract filename + extension from a URL and write into ``meta``.
 */
export function nameExtFromURL(
  url: string,
  meta: Record<string, unknown>,
): void {
  const filename = filenameFromURL(url)
  const dot = filename.lastIndexOf('.')
  if (dot > 0 && filename.length - dot - 1 <= 16) {
    meta.filename = unquote(filename.slice(0, dot))
    meta.extension = unquote(filename.slice(dot + 1)).toLowerCase()
  }
  else {
    meta.filename = unquote(filename)
    meta.extension = ''
  }
}

/**
 * Extract the file-name portion of a URL (before query string).
 */
function filenameFromURL(url: string): string {
  try {
    return url.split('?')[0]!.split('/').pop() ?? ''
  }
  catch {
    return ''
  }
}

/**
 * Parse an integer from a possibly-null value. Returns ``default_`` on failure.
 */
export function parseInt(
  value: string | number | null | undefined,
  default_: number = 0,
): number {
  if (value == null)
    return default_
  const n = typeof value === 'number'
    ? value
    : Number.parseInt(String(value), 10)
  return Number.isFinite(n)
    ? n
    : default_
}

// Regex helper: compile a pattern and call .findall()
export function tagRe(pattern: string): (text: string) => string[] {
  const re = new RegExp(pattern, 'g')
  return (text: string) => {
    const matches = text.match(re)
    return matches
      ? [
          ...new Set(matches),
        ]
      : []
  }
}

/** Pre-configured hashtag regex. */
export const findTags = tagRe('#\\w+')
