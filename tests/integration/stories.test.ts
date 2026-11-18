import type { Message, Storage } from '../../src/types'
import { describe, expect, it } from 'vitest'
import { ConfigManager } from '../../src/config'
import { noopLogger } from '../../src/core/extractor'
import { InstagramStoriesExtractor } from '../../src/instagram/extractors'
import { MockHttpClient } from '../helpers/mock-http'

const mockStorage: Storage = {
  exists: async () => false,
  write: async () => {},
  mkdir: async () => {},
}

describe('instagramStoriesExtractor integration', () => {
  const url = 'https://www.instagram.com/stories/rin_.t710/'

  const mockSearchData = {
    users: [
      {
        user: {
          pk: '54725833600',
          id: '54725833600',
          username: 'rin_.t710',
          full_name: 'Rin',
        },
      },
    ],
  }

  const mockUserData = {
    data: {
      user: {
        pk: '54725833600',
        id: '54725833600',
        username: 'rin_.t710',
        full_name: 'Rin',
        is_private: false,
        profile_pic_url: 'https://example.com/pic.jpg',
      },
    },
  }

  const mockStoryData = {
    reels_media: [
      {
        id: '54725833600',
        pk: '54725833600',
        user: { pk: '54725833600', username: 'rin_.t710', full_name: 'Rin' },
        items: [
          {
            pk: '3906328154789100102',
            taken_at: 1717000000,
            media_type: 2, // video
            image_versions2: {
              candidates: [
                {
                  url: 'https://example.com/story_frame.jpg',
                  width: 1080,
                  height: 1920,
                  url_signature: {},
                },
              ],
            },
            video_versions: [
              { url: 'https://example.com/story_video.mp4', width: 1080, height: 1920 },
            ],
          },
        ],
      },
    ],
  }

  it('yields story media with correct reel_ids (regression test for slice(1) bug)', async () => {
    const http = new MockHttpClient()
      .add('/api/v1/users/web_profile_info/', mockUserData)
      .add('/web/search/topsearch/', mockSearchData)
      .add('/api/v1/feed/reels_media/', mockStoryData)

    const match = InstagramStoriesExtractor.pattern.exec(url)!
    const extractor = new InstagramStoriesExtractor({
      url,
      match,
      config: new ConfigManager(),
      http,
      storage: mockStorage,
      log: noopLogger,
    })

    await extractor.initialize()

    const messages: Message[] = []
    for await (const msg of extractor) {
      messages.push(msg)
    }

    // Should yield directory + url for the story frame + video
    expect(messages.length).toBeGreaterThanOrEqual(2)

    const directory = messages.find(m => m.type === 'directory')
    expect(directory).toBeDefined()
    if (directory && directory.type === 'directory') {
      expect(directory.metadata.username).toBe('rin_.t710')
    }

    // Verify that media URLs are present — when the slice(1) bug existed,
    // reel_ids was ["highlight:https://..."] and no reels would be returned
    const urls = messages.filter(m => m.type === 'url')
    expect(urls.length).toBeGreaterThan(0)
  })

  it('uses the stories page payload when the REST reels endpoint is unavailable', async () => {
    const pagePayload = {
      require: [
        [
          'ScheduledServerJS',
          'handle',
          null,
          [
            {
              __bbox: {
                result: {
                  data: {
                    xdt_api__v1__feed__reels_media: {
                      reels_media: [
                        {
                          id: '54725833600',
                          reel_type: 'user_reel',
                          user: { pk: '54725833600', username: 'rin_.t710', full_name: 'Rin' },
                          items: [
                            {
                              pk: '3906328154789100102',
                              taken_at: 1717000000,
                              expiring_at: 1717086400,
                              media_type: 1,
                              image_versions2: {
                                candidates: [
                                  { url: 'https://example.com/page_frame.jpg', width: 1080, height: 1920 },
                                ],
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            },
          ],
        ],
      ],
    }
    const html = `<html><body><script type="application/json" nonce="abc" data-content-len="123" data-sjs>${JSON.stringify(pagePayload)}</script></body></html>`

    // No user-resolution or reels_media routes: only the page payload can work.
    const http = new MockHttpClient().add('/stories/rin_.t710/', html)

    const match = InstagramStoriesExtractor.pattern.exec(url)!
    const extractor = new InstagramStoriesExtractor({
      url,
      match,
      config: new ConfigManager(),
      http,
      storage: mockStorage,
      log: noopLogger,
    })

    await extractor.initialize()
    const messages: Message[] = []
    for await (const msg of extractor) {
      messages.push(msg)
    }

    const directory = messages.find(m => m.type === 'directory')
    expect(directory).toBeDefined()
    if (directory && directory.type === 'directory') {
      expect(directory.metadata.username).toBe('rin_.t710')
      expect(directory.metadata.type).toBe('story')
    }

    const urls = messages.filter(m => m.type === 'url')
    expect(urls).toHaveLength(1)
    if (urls[0] && urls[0].type === 'url') {
      expect(urls[0].url).toBe('https://example.com/page_frame.jpg')
    }
  })

  it('reads a direct highlight URL from the highlight page payload', async () => {
    const highlightId = '18115369870628555'
    const url = `https://www.instagram.com/stories/highlights/${highlightId}/`

    const pagePayload = {
      require: [
        [
          'ScheduledServerJS',
          'handle',
          null,
          [
            {
              __bbox: {
                complete: true,
                result: {
                  data: {
                    xdt_api__v1__feed__reels_media__connection: {
                      edges: [
                        {
                          node: {
                            // Real highlight nodes carry a GraphQL-ish
                            // __typename but keep the REST reel shape.
                            __typename: 'XDTReelDict',
                            id: `highlight:${highlightId}`,
                            title: '🌸お花🌸',
                            user: {
                              pk: '76727580985',
                              username: 'ritsu_mgmg',
                              full_name: 'Ritsu',
                            },
                            items: [
                              {
                                pk: '3827367937251133646',
                                id: '3827367937251133646_76727580985',
                                taken_at: 1717000000,
                                media_type: 1,
                                image_versions2: {
                                  candidates: [
                                    { url: 'https://example.com/highlight.jpg', width: 1080, height: 1920 },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          ],
        ],
      ],
    }
    const html = `<html><body><script type="application/json" data-sjs>${JSON.stringify(pagePayload)}</script></body></html>`

    // No /api/v1/feed/reels_media/ route: the page payload is the only source.
    const http = new MockHttpClient()
      .add(`/stories/highlights/${highlightId}/`, html)

    const match = InstagramStoriesExtractor.pattern.exec(url)!
    const extractor = new InstagramStoriesExtractor({
      url,
      match,
      config: new ConfigManager(),
      http,
      storage: mockStorage,
      log: noopLogger,
    })

    await extractor.initialize()
    const messages: Message[] = []
    for await (const msg of extractor) {
      messages.push(msg)
    }

    const directory = messages.find(m => m.type === 'directory')
    expect(directory).toBeDefined()
    if (directory && directory.type === 'directory') {
      expect(directory.metadata.type).toBe('highlight')
      expect(directory.metadata.username).toBe('ritsu_mgmg')
      expect(directory.metadata.highlight_title).toBe('🌸お花🌸')
    }

    const urls = messages.filter(m => m.type === 'url')
    expect(urls).toHaveLength(1)
    if (urls[0] && urls[0].type === 'url') {
      expect(urls[0].url).toBe('https://example.com/highlight.jpg')
    }
  })

  it('filters to specific media_id when provided in URL', async () => {
    const storyWithMultipleItems = {
      reels_media: [
        {
          id: '54725833600',
          pk: '54725833600',
          user: { pk: '54725833600', username: 'rin_.t710', full_name: 'Rin' },
          items: [
            {
              pk: '3906328154789100102',
              taken_at: 1717000000,
              media_type: 1,
              image_versions2: {
                candidates: [
                  {
                    url: 'https://example.com/frame1.jpg',
                    width: 1080,
                    height: 1920,
                    url_signature: {},
                  },
                ],
              },
            },
            {
              pk: '9999999999999999999', // different media — should be filtered out
              taken_at: 1717000001,
              media_type: 1,
              image_versions2: {
                candidates: [
                  {
                    url: 'https://example.com/frame2.jpg',
                    width: 1080,
                    height: 1920,
                    url_signature: {},
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const http = new MockHttpClient()
      .add('/api/v1/users/web_profile_info/', mockUserData)
      .add('/web/search/topsearch/', mockSearchData)
      .add('/api/v1/feed/reels_media/', storyWithMultipleItems)

    const mediaUrl
      = 'https://www.instagram.com/stories/rin_.t710/3906328154789100102/'
    const match = InstagramStoriesExtractor.pattern.exec(mediaUrl)!
    const extractor = new InstagramStoriesExtractor({
      url: mediaUrl,
      match,
      config: new ConfigManager(),
      http,
      storage: mockStorage,
      log: noopLogger,
    })

    await extractor.initialize()
    const messages: Message[] = []
    for await (const msg of extractor) {
      messages.push(msg)
    }

    // Only the matched item should survive — not both
    const directories = messages.filter(m => m.type === 'directory')
    expect(directories.length).toBe(1)

    const urls = messages.filter(m => m.type === 'url')
    expect(urls.length).toBe(1)
    if (urls[0] && urls[0].type === 'url') {
      expect(urls[0].metadata.media_id).toBe('3906328154789100102')
    }
  })

  it('yields nothing when the requested media_id is missing (expired story)', async () => {
    const http = new MockHttpClient()
      .add('/api/v1/users/web_profile_info/', mockUserData)
      .add('/web/search/topsearch/', mockSearchData)
      .add('/api/v1/feed/reels_media/', mockStoryData)

    const staleUrl
      = 'https://www.instagram.com/stories/rin_.t710/9999999999999999999/'
    const match = InstagramStoriesExtractor.pattern.exec(staleUrl)!
    const extractor = new InstagramStoriesExtractor({
      url: staleUrl,
      match,
      config: new ConfigManager(),
      http,
      storage: mockStorage,
      log: noopLogger,
    })

    await extractor.initialize()
    const messages: Message[] = []
    for await (const msg of extractor) {
      messages.push(msg)
    }

    // Must NOT fall back to the whole reel when the id doesn't match
    expect(messages.filter(m => m.type === 'directory').length).toBe(0)
    expect(messages.filter(m => m.type === 'url').length).toBe(0)
  })
})
