/**
 * Instagram-style Base64-variant ID ↔ shortcode conversion.
 */

const ALPHABET
  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Pre-built index for O(1) character lookup during decode. */
const CHAR_INDEX: Record<string, number> = {}
for (let i = 0; i < ALPHABET.length; i++) {
  CHAR_INDEX[ALPHABET[i]!] = i
}

const BASE = BigInt(ALPHABET.length)

/**
 * Decode an Instagram shortcode into its numeric post ID.
 */
export function idFromShortcode(shortcode: string): string {
  let num = 0n
  for (const ch of shortcode) {
    num = num * BASE + BigInt(CHAR_INDEX[ch] ?? 0)
  }
  return num.toString()
}

/**
 * Encode a numeric post ID into an Instagram shortcode.
 */
export function shortcodeFromId(postId: string | number): string {
  let num = BigInt(postId)
  const chars: string[] = []
  while (num > 0n) {
    const remainder = Number(num % BASE)
    chars.push(ALPHABET[remainder]!)
    num = num / BASE
  }
  return chars.reverse().join('')
}
