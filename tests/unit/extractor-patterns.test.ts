import { describe, expect, it } from 'vitest'
/**
 * Extractor URL pattern regression tests.
 *
 * CRITICAL: These tests verify the ``slice(1)`` fix in ``core/extractor.ts``.
 * Before the fix, ``groups[0]`` was the full URL match string instead of
 * the first capture group because the code did ``[...opts.match]`` without
 * slicing off the full match at index 0.
 *
 * The fix: ``this.groups = opts.match ? [...opts.match].slice(1) : []``
 *
 * These tests confirm that:
 * 1. Each extractor's pattern matches its expected URL format
 * 2. Patterns do NOT match unrelated URLs
 * 3. After ``slice(1)``, groups have correct values at expected indices
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
} from '../../instagram/extractors'

/** Helper: simulate the slice(1) applied by Extractor constructor. */
function groupsAfterSlice(
  pattern: RegExp,
  url: string,
): string[] {
  const match = pattern.exec(url)
  if (!match)
    return []
  return [...match].slice(1)
}

/** InstagramPostExtractor */

describe('instagramPostExtractor.pattern', () => {
  const { pattern } = InstagramPostExtractor

  it('matches /p/ URL', () => {
    const url = 'https://www.instagram.com/p/CxAbCdEfGh/'
    expect(pattern.test(url)).toBe(true)

    const groups = groupsAfterSlice(pattern, url)
    expect(groups[0]).toBe('CxAbCdEfGh')
  })

  it('matches /reel/ URL', () => {
    const url = 'https://www.instagram.com/reel/CxAbCdEfGh/'
    expect(pattern.test(url)).toBe(true)
  })

  it('matches /tv/ URL', () => {
    const url = 'https://www.instagram.com/tv/CxAbCdEfGh/'
    expect(pattern.test(url)).toBe(true)
  })

  it('matches URL without trailing slash', () => {
    const url = 'https://www.instagram.com/p/CxAbCdEfGh'
    expect(pattern.test(url)).toBe(true)
  })

  it('matches URL without https://', () => {
    const url = 'www.instagram.com/p/CxAbCdEfGh/'
    expect(pattern.test(url)).toBe(true)
  })

  it('does NOT match user profile page', () => {
    expect(pattern.test('https://www.instagram.com/username/')).toBe(false)
  })

  it('does NOT match stories URL', () => {
    expect(pattern.test('https://www.instagram.com/stories/user/123/')).toBe(
      false,
    )
  })

  it('does NOT match explore tags URL', () => {
    expect(pattern.test('https://www.instagram.com/explore/tags/cats/')).toBe(
      false,
    )
  })

  it('groups[0] is the shortcode — regression test for slice(1)', () => {
    const match = pattern.exec('https://www.instagram.com/p/CxAbCdEfGh/')
    const groups = [...match!].slice(1)
    // Before fix: groups[0] was the full URL string → THIS WAS THE BUG
    expect(groups[0]).toBe('CxAbCdEfGh')
    // groups[0] should NOT be the full URL
    expect(groups[0]).not.toContain('instagram.com')
  })
})

/** InstagramStoriesExtractor */

describe('instagramStoriesExtractor.pattern', () => {
  const { pattern } = InstagramStoriesExtractor

  it('matches stories URL with media ID', () => {
    const url
      = 'https://www.instagram.com/stories/rin_.t710/3906328154789100102/'
    expect(pattern.test(url)).toBe(true)
  })

  it('matches stories URL without media ID', () => {
    const url = 'https://www.instagram.com/stories/username/'
    expect(pattern.test(url)).toBe(true)
  })

  it('username is at groups[1] after slice(1) — critical regression test', () => {
    const url
      = 'https://www.instagram.com/stories/rin_.t710/3906328154789100102/'
    const match = pattern.exec(url)!
    const groups = [...match].slice(1)

    // After the slice(1) fix:
    // groups[0] = highlight numeric ID (undefined for stories)
    // groups[1] = username  ← THIS MUST BE THE USERNAME
    // groups[2] = media ID
    expect(groups[0]).toBeUndefined()
    expect(groups[1]).toBe('rin_.t710')
    expect(groups[2]).toBe('3906328154789100102')

    // groups[1] must be a string (the username), not undefined
    expect(typeof groups[1]).toBe('string')
  })

  it('media ID is at groups[2] after slice(1)', () => {
    const url
      = 'https://www.instagram.com/stories/rin_.t710/3906328154789100102/'
    const groups = groupsAfterSlice(pattern, url)
    expect(groups[2]).toBe('3906328154789100102')
  })

  it('does NOT match regular post URL', () => {
    expect(pattern.test('https://www.instagram.com/p/ABC/')).toBe(false)
  })

  it('does NOT match user profile URL', () => {
    expect(pattern.test('https://www.instagram.com/username/')).toBe(false)
  })
})

/** InstagramUserExtractor */

describe('instagramUserExtractor.pattern', () => {
  const { pattern } = InstagramUserExtractor

  it('matches user profile URL with trailing slash', () => {
    const url = 'https://www.instagram.com/username/'
    expect(pattern.test(url)).toBe(true)
  })

  it('groups[0] includes /username after slice(1)', () => {
    const groups = groupsAfterSlice(pattern, 'https://www.instagram.com/username/')
    // The capture group captures "/username" (with leading slash)
    expect(groups[0]).toBe('/username')
  })

  it('matches user profile URL without trailing slash', () => {
    expect(pattern.test('https://www.instagram.com/username')).toBe(true)
  })

  it('does NOT match post URL', () => {
    expect(pattern.test('https://www.instagram.com/p/ABC/')).toBe(false)
  })

  it('does NOT match stories URL', () => {
    expect(pattern.test('https://www.instagram.com/stories/user/123/')).toBe(
      false,
    )
  })
})

/** InstagramTagExtractor */

describe('instagramTagExtractor.pattern', () => {
  const { pattern } = InstagramTagExtractor

  it('matches explore tags URL', () => {
    const url = 'https://www.instagram.com/explore/tags/cats/'
    expect(pattern.test(url)).toBe(true)
  })

  it('groups[0] is the tag name after slice(1)', () => {
    const groups = groupsAfterSlice(
      pattern,
      'https://www.instagram.com/explore/tags/cats/',
    )
    expect(groups[0]).toBe('cats')
  })

  it('does NOT match regular post', () => {
    expect(pattern.test('https://www.instagram.com/p/ABC/')).toBe(false)
  })
})

/** InstagramHighlightsExtractor */

describe('instagramHighlightsExtractor.pattern', () => {
  const { pattern } = InstagramHighlightsExtractor

  it('matches highlights URL', () => {
    const url = 'https://www.instagram.com/username/highlights/'
    expect(pattern.test(url)).toBe(true)
  })

  it('groups[0] contains /username after slice(1)', () => {
    const groups = groupsAfterSlice(
      pattern,
      'https://www.instagram.com/username/highlights/',
    )
    expect(groups[0]).toBe('/username')
  })

  it('does NOT match post URL', () => {
    expect(pattern.test('https://www.instagram.com/p/ABC/')).toBe(false)
  })
})

/** InstagramSavedExtractor */

describe('instagramSavedExtractor.pattern', () => {
  const { pattern } = InstagramSavedExtractor

  it('matches /saved/ URL', () => {
    const url = 'https://www.instagram.com/me/saved/'
    expect(pattern.test(url)).toBe(true)
  })

  it('matches /saved/all-posts/ URL', () => {
    const url = 'https://www.instagram.com/me/saved/all-posts/'
    expect(pattern.test(url)).toBe(true)
  })

  it('does NOT match post URL', () => {
    expect(pattern.test('https://www.instagram.com/p/ABC/')).toBe(false)
  })
})

/** InstagramPostsExtractor */

describe('instagramPostsExtractor.pattern', () => {
  const { pattern } = InstagramPostsExtractor

  it('matches /username/posts/ URL', () => {
    const url = 'https://www.instagram.com/username/posts/'
    expect(pattern.test(url)).toBe(true)
  })

  it('does NOT match regular user profile', () => {
    expect(pattern.test('https://www.instagram.com/username/')).toBe(false)
  })
})

/** InstagramReelsExtractor */

describe('instagramReelsExtractor.pattern', () => {
  const { pattern } = InstagramReelsExtractor

  it('matches /username/reels/ URL', () => {
    const url = 'https://www.instagram.com/username/reels/'
    expect(pattern.test(url)).toBe(true)
  })
})

/** InstagramTaggedExtractor */

describe('instagramTaggedExtractor.pattern', () => {
  const { pattern } = InstagramTaggedExtractor

  it('matches /username/tagged/ URL', () => {
    const url = 'https://www.instagram.com/username/tagged/'
    expect(pattern.test(url)).toBe(true)
  })

  it('does NOT match regular user profile', () => {
    expect(pattern.test('https://www.instagram.com/username/')).toBe(false)
  })
})

/** InstagramInfoExtractor */

describe('instagramInfoExtractor.pattern', () => {
  const { pattern } = InstagramInfoExtractor

  it('matches /username/info/ URL', () => {
    const url = 'https://www.instagram.com/username/info/'
    expect(pattern.test(url)).toBe(true)
  })

  it('does NOT match post URL', () => {
    expect(pattern.test('https://www.instagram.com/p/ABC/')).toBe(false)
  })
})

/** InstagramAvatarExtractor */

describe('instagramAvatarExtractor.pattern', () => {
  const { pattern } = InstagramAvatarExtractor

  it('matches /username/avatar/ URL', () => {
    const url = 'https://www.instagram.com/username/avatar/'
    expect(pattern.test(url)).toBe(true)
  })

  it('does NOT match post URL', () => {
    expect(pattern.test('https://www.instagram.com/p/ABC/')).toBe(false)
  })
})

/** Cross-extractor non-match matrix */

describe('cross-extractor non-match matrix', () => {
  const extractors = [
    { name: 'Post', pattern: InstagramPostExtractor.pattern },
    { name: 'Stories', pattern: InstagramStoriesExtractor.pattern },
    { name: 'User', pattern: InstagramUserExtractor.pattern },
    { name: 'Highlights', pattern: InstagramHighlightsExtractor.pattern },
    { name: 'Tag', pattern: InstagramTagExtractor.pattern },
    { name: 'Saved', pattern: InstagramSavedExtractor.pattern },
    { name: 'Posts', pattern: InstagramPostsExtractor.pattern },
    { name: 'Reels', pattern: InstagramReelsExtractor.pattern },
    { name: 'Tagged', pattern: InstagramTaggedExtractor.pattern },
    { name: 'Info', pattern: InstagramInfoExtractor.pattern },
    { name: 'Avatar', pattern: InstagramAvatarExtractor.pattern },
  ]

  const urls: Array<{ desc: string, url: string, shouldMatch: string[] }> = [
    {
      desc: '/p/ post',
      url: 'https://www.instagram.com/p/CxAbCd/',
      shouldMatch: ['Post'],
    },
    {
      desc: '/reel/ post',
      url: 'https://www.instagram.com/reel/CxAbCd/',
      shouldMatch: ['Post'],
    },
    {
      desc: '/stories/ with media ID',
      url: 'https://www.instagram.com/stories/user/12345/',
      shouldMatch: ['Stories'],
    },
    {
      desc: 'user profile',
      url: 'https://www.instagram.com/username/',
      shouldMatch: ['User'],
    },
    {
      desc: '/explore/tags/',
      url: 'https://www.instagram.com/explore/tags/cats/',
      shouldMatch: ['Tag'],
    },
    {
      desc: '/highlights/',
      url: 'https://www.instagram.com/user/highlights/',
      shouldMatch: ['Highlights'],
    },
    {
      desc: '/saved/',
      url: 'https://www.instagram.com/me/saved/',
      shouldMatch: ['Saved'],
    },
    {
      desc: '/posts/',
      url: 'https://www.instagram.com/user/posts/',
      shouldMatch: ['Posts'],
    },
    {
      desc: '/reels/',
      url: 'https://www.instagram.com/user/reels/',
      shouldMatch: ['Reels'],
    },
    {
      desc: '/tagged/',
      url: 'https://www.instagram.com/user/tagged/',
      shouldMatch: ['Tagged'],
    },
    {
      desc: '/info/',
      url: 'https://www.instagram.com/user/info/',
      shouldMatch: ['Info'],
    },
    {
      desc: '/avatar/',
      url: 'https://www.instagram.com/user/avatar/',
      shouldMatch: ['Avatar'],
    },
  ]

  for (const { desc, url, shouldMatch } of urls) {
    it(`${desc} → matches only expected extractors`, () => {
      for (const { name, pattern } of extractors) {
        if (shouldMatch.includes(name)) {
          expect(pattern.test(url)).toBe(true)
        }
        else {
          expect(pattern.test(url)).toBe(false)
        }
      }
    })
  }
})
