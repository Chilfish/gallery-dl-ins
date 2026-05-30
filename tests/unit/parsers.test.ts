import type {
  InstagramPost,
  ParserConfig,
} from '../../src/instagram/types'
import { describe, expect, it } from 'vitest'
import { parsePostGraphql, parsePostRest } from '../../src/instagram/parsers'
import { findTags } from '../../src/utils/text'

/**
 * Post parser tests — normalize raw API responses into ParsedPost.
 *
 * Tests both ``parsePostRest`` and ``parsePostGraphql`` with realistic
 * mock InstagramPost data.
 */

/** Shared parser config for tests */
function makeParserConfig(overrides: Partial<ParserConfig> = {}): ParserConfig {
  return {
    root: 'https://www.instagram.com',
    findTags,
    parseTimestamp: (ts: number | null | undefined) => {
      if (ts == null)
        return ''
      const asMs = ts > 2_500_000_000 ? ts : ts * 1000
      return new Date(asMs).toISOString()
    },
    staticVideo: false,
    warnVideo: false,
    warnImage: 0,
    videosDash: false,
    ...overrides,
  }
}

/** Minimal mock user */
const mockUser = {
  pk: '12345',
  username: 'testuser',
  full_name: 'Test User',
}

/** Minimal mock image version */
const mockImage = {
  candidates: [{ url: 'https://example.com/photo.jpg', width: 1080, height: 1350 }],
}

/** REST parser */

describe('parsePostRest', () => {
  const cfg = makeParserConfig()

  it('parses a single-image post with required fields', () => {
    const post: InstagramPost = {
      pk: '3400000000000000001',
      code: 'CxAbCdEfGh',
      caption: { text: 'Hello world #test' },
      taken_at: 1700000000,
      user: mockUser,
      image_versions2: mockImage,
    }

    const result = parsePostRest(post, cfg)

    expect(result.post_id).toBe('3400000000000000001')
    expect(result.post_shortcode).toBe('CxAbCdEfGh')
    expect(result.post_url).toBe('https://www.instagram.com/p/CxAbCdEfGh/')
    expect(result.username).toBe('testuser')
    expect(result.fullname).toBe('Test User')
    expect(result.description).toBe('Hello world #test')
    expect(result.type).toBe('post')
    expect(result._files.length).toBeGreaterThanOrEqual(1)
    expect(result._files[0]!.display_url).toBe('https://example.com/photo.jpg')
    expect(result._files[0]!.media_id).toBe('3400000000000000001')
  })

  it('parses a carousel post with multiple images', () => {
    const post: InstagramPost = {
      pk: '3400000000000000002',
      code: 'Carousel1',
      caption: null,
      taken_at: 1700000000,
      user: mockUser,
      image_versions2: mockImage,
      carousel_media: [
        {
          pk: '3400000000000000003',
          image_versions2: {
            candidates: [{ url: 'https://example.com/img1.jpg', width: 1080, height: 1080 }],
          },
        },
        {
          pk: '3400000000000000004',
          image_versions2: {
            candidates: [{ url: 'https://example.com/img2.jpg', width: 1080, height: 1080 }],
          },
        },
      ],
    }

    const result = parsePostRest(post, cfg)

    expect(result.type).toBe('post')
    expect(result.sidecar_media_id).toBe('3400000000000000002')
    expect(result._files).toHaveLength(2)
    expect(result._files[0]!.display_url).toBe('https://example.com/img1.jpg')
    expect(result._files[1]!.display_url).toBe('https://example.com/img2.jpg')
  })

  it('parses a video post as reel type', () => {
    const post: InstagramPost = {
      pk: '3400000000000000005',
      code: 'VideoPost',
      caption: null,
      taken_at: 1700000000,
      user: mockUser,
      image_versions2: mockImage,
      video_versions: [
        { url: 'https://example.com/video.mp4', width: 1080, height: 1920, type: 101 },
      ],
    }

    const result = parsePostRest(post, cfg)

    expect(result.type).toBe('reel')
    expect(result.post_url).toBe('https://www.instagram.com/reel/VideoPost/')
    expect(result._files[0]!.video_url).toBe('https://example.com/video.mp4')
  })

  it('parses a story post with items', () => {
    const post: InstagramPost = {
      pk: 'highlight:12345',
      id: 'highlight:12345',
      code: 'StoryCode',
      caption: null,
      taken_at: 1700000000,
      expiring_at: 1700086400,
      user: mockUser,
      image_versions2: mockImage,
      items: [
        {
          pk: '3400000000000000006',
          taken_at: 1700000001,
          image_versions2: {
            candidates: [{ url: 'https://example.com/story1.jpg', width: 1080, height: 1920 }],
          },
        },
        {
          pk: '3400000000000000007',
          taken_at: 1700000002,
          image_versions2: {
            candidates: [{ url: 'https://example.com/story2.jpg', width: 1080, height: 1920 }],
          },
        },
      ],
    }

    const result = parsePostRest(post, cfg)

    expect(result.type).toBe('story')
    expect(result._files).toHaveLength(2)
    expect(result.username).toBe('testuser')
  })

  it('includes tags from description', () => {
    const post: InstagramPost = {
      pk: '3400000000000000008',
      code: 'TaggedPost',
      caption: { text: 'Check this #photography #nature' },
      taken_at: 1700000000,
      user: mockUser,
      image_versions2: mockImage,
    }

    const result = parsePostRest(post, cfg)

    expect(result.tags).toContain('#photography')
    expect(result.tags).toContain('#nature')
  })

  it('handles coauthors', () => {
    const post: InstagramPost = {
      pk: '3400000000000000009',
      code: 'CollabPost',
      caption: null,
      taken_at: 1700000000,
      user: mockUser,
      image_versions2: mockImage,
      coauthor_producers: [
        { pk: '99999', username: 'coauthor1', full_name: 'Co Author' },
      ],
    }

    const result = parsePostRest(post, cfg)

    expect(result.coauthors).toBeDefined()
    expect(result.coauthors![0]!.username).toBe('coauthor1')
  })

  it('handles post with location', () => {
    const post: InstagramPost = {
      pk: '3400000000000000010',
      code: 'LocationPost',
      caption: null,
      taken_at: 1700000000,
      user: mockUser,
      image_versions2: mockImage,
      location: {
        pk: '100',
        short_name: 'Tokyo',
      },
    }

    const result = parsePostRest(post, cfg)

    expect(result.location_id).toBe('100')
    expect(result.location_slug).toBe('tokyo')
    expect(result.location_url).toContain('/explore/locations/100/tokyo/')
  })
})

/** GraphQL parser */

describe('parsePostGraphql', () => {
  const cfg = makeParserConfig()

  it('parses a single GraphQL image node', () => {
    const post = {
      __typename: 'GraphImage',
      id: '3400000000000000101',
      shortcode: 'GraphQL1',
      taken_at_timestamp: 1700000000,
      owner: {
        id: '12345',
        pk: '12345',
        username: 'testuser',
        full_name: 'Test User',
      },
      edge_media_to_caption: {
        edges: [{ node: { text: 'GraphQL caption' } }],
      },
      display_url: 'https://example.com/gql.jpg',
      dimensions: { width: 1080, height: 1080 },
      viewer_has_liked: true,
      edge_media_preview_like: { count: 100 },
    }

    const result = parsePostGraphql(post, cfg)

    expect(result.post_id).toBe('3400000000000000101')
    expect(result.post_shortcode).toBe('GraphQL1')
    expect(result.username).toBe('testuser')
    expect(result.description).toBe('GraphQL caption')
    expect(result.likes).toBe(100)
    expect(result.liked).toBe(true)
    expect(result.type).toBe('post')
    expect(result._files).toHaveLength(1)
    expect(result._files[0]!.display_url).toBe('https://example.com/gql.jpg')
  })

  it('parses a GraphQL carousel', () => {
    const post = {
      __typename: 'GraphSidecar',
      id: '3400000000000000102',
      shortcode: 'Sidecar1',
      taken_at_timestamp: 1700000000,
      owner: {
        id: '12345',
        pk: '12345',
        username: 'testuser',
        full_name: 'Test User',
      },
      edge_media_to_caption: { edges: [] },
      dimensions: { width: 1080, height: 1080 },
      edge_sidecar_to_children: {
        edges: [
          {
            node: {
              id: '3400000000000000103',
              shortcode: 'Sidecar1_1',
              display_url: 'https://example.com/sc1.jpg',
              dimensions: { width: 1080, height: 1080 },
            },
          },
          {
            node: {
              id: '3400000000000000104',
              shortcode: 'Sidecar1_2',
              display_url: 'https://example.com/sc2.jpg',
              video_url: 'https://example.com/sc2.mp4',
              dimensions: { width: 1080, height: 1920 },
            },
          },
        ],
      },
    }

    const result = parsePostGraphql(post, cfg)

    expect(result.sidecar_media_id).toBe('3400000000000000102')
    expect(result._files).toHaveLength(2)
    expect(result._files[0]!.display_url).toBe('https://example.com/sc1.jpg')
    expect(result._files[1]!.video_url).toBe('https://example.com/sc2.mp4')
  })

  it('handles pinned users', () => {
    const post = {
      __typename: 'GraphImage',
      id: '3400000000000000105',
      shortcode: 'Pinned1',
      taken_at_timestamp: 1700000000,
      owner: {
        id: '12345',
        pk: '12345',
        username: 'testuser',
        full_name: 'Test User',
      },
      edge_media_to_caption: { edges: [] },
      display_url: 'https://example.com/gql.jpg',
      dimensions: { width: 1080, height: 1080 },
      pinned_for_users: [{ id: '99999' }, { id: '88888' }],
    }

    const result = parsePostGraphql(post, cfg)

    expect(result.pinned).toHaveLength(2)
  })
})
