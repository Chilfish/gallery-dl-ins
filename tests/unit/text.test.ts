import { describe, expect, it } from 'vitest'

/**
 * Text utilities tests — pure functions from utils/text.ts
 */

import {
  ensureHttpScheme,
  extr,
  extract,
  findTags,
  nameExtFromURL,
  parseInt,
  parseUnicodeEscapes,
  unescape,
  unquote,
} from '../../src/utils/text'

describe('extract', () => {
  it('extracts substring between delimiters', () => {
    expect(extract('<html>content</html>', '<html>', '</html>')).toBe(
      'content',
    )
  })

  it('returns null when opening delimiter is missing', () => {
    expect(extract('no opener here', '<begin>', '</end>')).toBeNull()
  })

  it('returns null when closing delimiter is missing', () => {
    expect(extract('<begin>no closer', '<begin>', '</end>')).toBeNull()
  })

  it('extracts between first occurrence of each delimiter', () => {
    expect(extract('a{first}b{second}c', '{', '}')).toBe('first')
  })

  it('handles empty result', () => {
    expect(extract('<>', '<', '>')).toBe('')
  })
})

describe('extr', () => {
  it('returns extracted string on success', () => {
    expect(extr('a<X>b', '<', '>')).toBe('X')
  })

  it('returns default when extraction fails', () => {
    expect(extr('no match', '<', '>', 'fallback')).toBe('fallback')
  })

  it('returns empty string as default when not specified', () => {
    expect(extr('no match', '<', '>')).toBe('')
  })
})

describe('parseUnicodeEscapes', () => {
  it('decodes \\uXXXX sequences', () => {
    expect(parseUnicodeEscapes('\\u0041')).toBe('A')
    expect(parseUnicodeEscapes('\\u4e16\\u754c')).toBe('世界')
  })

  it('returns the string unchanged if no escape sequences', () => {
    expect(parseUnicodeEscapes('hello world')).toBe('hello world')
  })

  it('handles mixed content', () => {
    expect(parseUnicodeEscapes('\\u0041BC\\u0044')).toBe('ABCD')
  })
})

describe('unescape', () => {
  it('decodes HTML entities', () => {
    expect(unescape('&amp;')).toBe('&')
    expect(unescape('&lt;')).toBe('<')
    expect(unescape('&gt;')).toBe('>')
    expect(unescape('&quot;')).toBe('"')
    expect(unescape('&apos;')).toBe('\'')
    expect(unescape('&nbsp;')).toBe('\u00A0')
  })

  it('handles text without entities', () => {
    expect(unescape('plain text')).toBe('plain text')
  })

  it('handles numeric entities', () => {
    expect(unescape('&#65;')).toBe('A')
    expect(unescape('&#x41;')).toBe('A')
  })

  it('leaves unrecognized entities as-is', () => {
    expect(unescape('&unknown;')).toBe('&unknown;')
  })
})

describe('unquote', () => {
  it('decodes URL-encoded strings', () => {
    expect(unquote('hello%20world')).toBe('hello world')
    expect(unquote('%E4%B8%96%E7%95%8C')).toBe('世界')
  })

  it('returns plain text unchanged', () => {
    expect(unquote('hello')).toBe('hello')
  })

  it('handles invalid sequences gracefully', () => {
    // Incomplete percent sequence
    const result = unquote('%ZZ')
    // Should not throw; may return the original or partially decoded
    expect(typeof result).toBe('string')
  })
})

describe('ensureHttpScheme', () => {
  it('adds https:// when missing', () => {
    expect(ensureHttpScheme('example.com')).toBe('https://example.com')
  })

  it('preserves existing https://', () => {
    expect(ensureHttpScheme('https://example.com')).toBe('https://example.com')
  })

  it('preserves existing http://', () => {
    expect(ensureHttpScheme('http://example.com')).toBe('http://example.com')
  })

  it('returns empty string for empty input', () => {
    expect(ensureHttpScheme('')).toBe('')
  })

  it('strips leading slashes before adding scheme', () => {
    expect(ensureHttpScheme('//example.com/path')).toBe(
      'https://example.com/path',
    )
  })
})

describe('nameExtFromURL', () => {
  it('extracts filename and extension', () => {
    const meta: Record<string, unknown> = {}
    nameExtFromURL('https://example.com/images/photo.jpg?q=1', meta)
    expect(meta.filename).toBe('photo')
    expect(meta.extension).toBe('jpg')
  })

  it('handles URLs without extension', () => {
    const meta: Record<string, unknown> = {}
    nameExtFromURL('https://example.com/images/photo', meta)
    expect(meta.filename).toBe('photo')
    expect(meta.extension).toBe('')
  })

  it('handles long extensions as part of filename', () => {
    const meta: Record<string, unknown> = {}
    // Extension longer than 16 chars → treated as filename
    nameExtFromURL('https://example.com/file.thisisareallylongextension', meta)
    expect(meta.filename).toBe('file.thisisareallylongextension')
    expect(meta.extension).toBe('')
  })
})

describe('parseInt', () => {
  it('parses string to integer', () => {
    expect(parseInt('42')).toBe(42)
  })

  it('returns default for null', () => {
    expect(parseInt(null, 10)).toBe(10)
  })

  it('returns default for undefined', () => {
    expect(parseInt(undefined, 10)).toBe(10)
  })

  it('returns default for non-numeric string', () => {
    expect(parseInt('abc', 5)).toBe(5)
  })

  it('defaults to 0 when no default given', () => {
    expect(parseInt('abc')).toBe(0)
  })
})

describe('findTags', () => {
  it('finds hashtags in text', () => {
    const tags = findTags('#hello #world text')
    expect(tags).toContain('#hello')
    expect(tags).toContain('#world')
  })

  it('deduplicates tags', () => {
    const tags = findTags('#dupe #dupe')
    expect(tags).toEqual(['#dupe'])
  })

  it('returns empty array for text without hashtags', () => {
    expect(findTags('no tags here')).toEqual([])
  })
})
