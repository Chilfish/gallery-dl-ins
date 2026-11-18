import { describe, expect, it } from 'vitest'
/**
 * SDK URL routing tests.
 *
 * Verify that the resolve logic (matching SDK's ``_resolve`` method)
 * routes Instagram URLs to the correct extractor.
 *
 * Since ``_resolve`` is private, we replicate the pattern-matching order
 * used in ``sdk.ts`` to test the routing logic.
 */

import {
  InstagramAvatarExtractor,
  InstagramHighlightsExtractor,
  InstagramInfoExtractor,
  InstagramPostExtractor,
  InstagramPostsExtractor,
  InstagramReelsExtractor,
  InstagramSavedExtractor,
  InstagramStoriesExtractor,
  InstagramTagExtractor,
  InstagramTaggedExtractor,
  InstagramUserExtractor,
} from '../../src/instagram/extractors'

/**
 * Replicate SDK's _resolve ordering.
 * Each entry is [name, ExtractorClass] in the exact order used in sdk.ts.
 */
const RESOLVE_ORDER: Array<[string, { pattern: RegExp }]> = [
  ['post', InstagramPostExtractor],
  ['stories', InstagramStoriesExtractor],
  ['highlights', InstagramHighlightsExtractor],
  ['tag', InstagramTagExtractor],
  ['saved', InstagramSavedExtractor],
  ['posts', InstagramPostsExtractor],
  ['reels', InstagramReelsExtractor],
  ['tagged', InstagramTaggedExtractor],
  ['info', InstagramInfoExtractor],
  ['avatar', InstagramAvatarExtractor],
  ['user', InstagramUserExtractor],
]

function resolveUrl(url: string): string | null {
  for (const [name, cls] of RESOLVE_ORDER) {
    if (cls.pattern.test(url))
      return name
  }
  return null
}

describe('sDK URL resolve', () => {
  it('routes /p/ to post extractor', () => {
    expect(resolveUrl('https://www.instagram.com/p/ABC123/')).toBe('post')
  })

  it('routes /reel/ to post extractor', () => {
    expect(resolveUrl('https://www.instagram.com/reel/ABC123/')).toBe('post')
  })

  it('routes user profile to user extractor', () => {
    expect(resolveUrl('https://www.instagram.com/username/')).toBe('user')
  })

  it('routes /stories/ to stories extractor', () => {
    expect(
      resolveUrl('https://www.instagram.com/stories/user/12345/'),
    ).toBe('stories')
  })

  it('routes /stories/highlights/{id}/ to stories extractor', () => {
    expect(
      resolveUrl('https://www.instagram.com/stories/highlights/18115369870628555/'),
    ).toBe('stories')
  })

  it('routes /highlights/ to highlights extractor', () => {
    expect(
      resolveUrl('https://www.instagram.com/username/highlights/'),
    ).toBe('highlights')
  })

  it('routes /explore/tags/ to tag extractor', () => {
    expect(
      resolveUrl('https://www.instagram.com/explore/tags/cats/'),
    ).toBe('tag')
  })

  it('routes /saved/ to saved extractor', () => {
    expect(resolveUrl('https://www.instagram.com/me/saved/')).toBe('saved')
  })

  it('routes /posts/ to posts extractor', () => {
    expect(resolveUrl('https://www.instagram.com/user/posts/')).toBe('posts')
  })

  it('routes /reels/ to reels extractor', () => {
    expect(resolveUrl('https://www.instagram.com/user/reels/')).toBe('reels')
  })

  it('routes /tagged/ to tagged extractor', () => {
    expect(resolveUrl('https://www.instagram.com/user/tagged/')).toBe('tagged')
  })

  it('routes /info/ to info extractor', () => {
    expect(resolveUrl('https://www.instagram.com/user/info/')).toBe('info')
  })

  it('routes /avatar/ to avatar extractor', () => {
    expect(resolveUrl('https://www.instagram.com/user/avatar/')).toBe('avatar')
  })

  it('returns null for unknown URL pattern', () => {
    expect(resolveUrl('https://example.com/not-instagram')).toBeNull()
  })

  it('returns null for unrelated Instagram URL', () => {
    expect(
      resolveUrl('https://www.instagram.com/accounts/login/'),
    ).toBeNull()
  })
})
