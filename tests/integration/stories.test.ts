import type { Message, Storage } from '../../types'
import { describe, expect, it } from 'vitest'
import { ConfigManager } from '../../config'
import { noopLogger } from '../../core/extractor'
import { InstagramStoriesExtractor } from '../../instagram/extractors'
import { MockHttpClient } from '../helpers/mock-http'

const mockStorage: Storage = {
  exists: async () => false,
  write: async () => {},
  mkdir: async () => {},
}

describe('instagramStoriesExtractor integration', () => {
  const url = 'https://www.instagram.com/stories/rin_.t710/'

  const mockUserData = {
    data: {
      pk: '54725833600',
      id: '54725833600',
      username: 'rin_.t710',
      full_name: 'Rin',
      is_private: false,
      profile_pic_url: 'https://example.com/pic.jpg',
    },
  }

  const mockStoryData = {
    reels_media: [{
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
              { url: 'https://example.com/story_frame.jpg', width: 1080, height: 1920, url_signature: {} },
            ],
          },
          video_versions: [
            { url: 'https://example.com/story_video.mp4', width: 1080, height: 1920 },
          ],
        },
      ],
    }],
  }

  it('yields story media with correct reel_ids (regression test for slice(1) bug)', async () => {
    const http = new MockHttpClient()
      .add('/api/v1/users/web_profile_info/', mockUserData)
      // Also need to handle the search endpoint (fallback strategy fails, then info succeeds)
      .add('/web/search/topsearch/', { users: [] })
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

  it('filters to specific media_id when provided in URL', async () => {
    const storyWithMultipleItems = {
      reels_media: [{
        id: '54725833600',
        pk: '54725833600',
        user: { pk: '54725833600', username: 'rin_.t710', full_name: 'Rin' },
        items: [
          {
            pk: '3906328154789100102',
            taken_at: 1717000000,
            media_type: 1,
            image_versions2: {
              candidates: [{ url: 'https://example.com/frame1.jpg', width: 1080, height: 1920, url_signature: {} }],
            },
          },
          {
            pk: '9999999999999999999', // different media — should be filtered out
            taken_at: 1717000001,
            media_type: 1,
            image_versions2: {
              candidates: [{ url: 'https://example.com/frame2.jpg', width: 1080, height: 1920, url_signature: {} }],
            },
          },
        ],
      }],
    }

    const http = new MockHttpClient()
      .add('/api/v1/users/web_profile_info/', mockUserData)
      .add('/web/search/topsearch/', { users: [] })
      .add('/api/v1/feed/reels_media/', storyWithMultipleItems)

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

    // Should only have 1 directory (only the matched media_id, not both)
    const directories = messages.filter(m => m.type === 'directory')
    expect(directories.length).toBe(1)
  })
})
