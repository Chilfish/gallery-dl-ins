/**
 * ID ↔ shortcode roundtrip tests.
 *
 * Instagram uses a custom Base64 alphabet to encode numeric post IDs
 * into shortcodes found in URLs.  These tests verify both directions.
 */

import { idFromShortcode, shortcodeFromId } from '../../utils/id-codec'

describe('idFromShortcode', () => {
  it('decodes known shortcodes to numeric IDs', () => {
    // Verified: A=0, B=1, C=2 in the Alphabet
    expect(idFromShortcode('B')).toBe('1')
    expect(idFromShortcode('C')).toBe('2')
    expect(idFromShortcode('BB')).toBe('65')
  })

  it('returns "0" for an empty string', () => {
    expect(idFromShortcode('')).toBe('0')
  })

  it('handles shortcodes with hyphens and underscores', () => {
    // - is index 62, _ is index 63 in the alphabet
    const result = idFromShortcode('--__')
    expect(typeof result).toBe('string')
    expect(BigInt(result) > 0n).toBe(true)
  })
})

describe('shortcodeFromId', () => {
  it('encodes numeric IDs to known shortcodes', () => {
    expect(shortcodeFromId('1')).toBe('B')
    expect(shortcodeFromId('2')).toBe('C')
    expect(shortcodeFromId('65')).toBe('BB')
  })

  it('roundtrips large numeric IDs', () => {
    const id = '3451081400122098390'
    const sc = shortcodeFromId(id)
    expect(idFromShortcode(sc)).toBe(id)
  })

  it('handles numeric input', () => {
    expect(shortcodeFromId(1)).toBe('B')
    expect(shortcodeFromId(65)).toBe('BB')
  })
})

describe('roundtrip consistency', () => {
  it('shortcode → id → shortcode preserves original', () => {
    const originals = [
      'CxAbCdEfGh',
      'BkR2x5PnsZm',
      'a1b2c3d4e5',
      '_-_-test',
    ]

    for (const sc of originals) {
      const id = idFromShortcode(sc)
      const back = shortcodeFromId(id)
      expect(back).toBe(sc)
    }
  })

  it('id → shortcode → id preserves original', () => {
    const ids = [
      '3451081400122098390',
      '1234567890123456789',
      '9999999999999999999',
      '1',
      '64',
      '4096',
    ]

    for (const id of ids) {
      const sc = shortcodeFromId(id)
      const back = idFromShortcode(sc)
      expect(back).toBe(id)
    }
  })
})
