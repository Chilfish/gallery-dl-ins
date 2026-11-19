import type { Message, Storage } from '../../src/types'
import { describe, expect, it } from 'vitest'
import { ConfigManager } from '../../src/config'
import { noopLogger } from '../../src/core/extractor'
import { InstagramPostExtractor } from '../../src/instagram/extractors'
import { MockHttpClient } from '../helpers/mock-http'

const mockStorage: Storage = {
  exists: async () => false,
  write: async () => {},
  mkdir: async () => {},
}

const mockUser = {
  pk: '12345',
  username: 'reel_user',
  full_name: 'Reel User',
  is_private: false,
  profile_pic_url: 'https://example.com/pic.jpg',
}

describe('instagram reel extraction', () => {
  const url = 'https://www.instagram.com/reel/CStRGxeA8Q9/'

  const mockReel = {
    items: [
      {
        pk: '3400000000000000002',
        code: 'CStRGxeA8Q9',
        taken_at: 1717000000,
        user: mockUser,
        caption: { text: 'Check out this reel!' },
        like_count: 100,
        media_type: 2, // video
        image_versions2: {
          candidates: [
            {
              url: 'https://example.com/reel_thumb.jpg',
              width: 1080,
              height: 1920,
              url_signature: {},
            },
          ],
        },
        video_versions: [
          {
            url: 'https://example.com/reel_video.mp4',
            width: 1080,
            height: 1920,
            type: 101,
          },
        ],
        comment_count: 5,
        has_liked: true,
      },
    ],
    num_results: 1,
    more_available: false,
  }

  it('yields video url for a reel', async () => {
    const http = new MockHttpClient()
      .add('/api/v1/media/', mockReel)

    const match = InstagramPostExtractor.pattern.exec(url)!
    const extractor = new InstagramPostExtractor({
      url,
      match,
      config: new ConfigManager(),
      http,
      storage: mockStorage,
      log: noopLogger,
      requestInterval: [0, 0],
    })

    await extractor.initialize()
    const messages: Message[] = []
    for await (const msg of extractor) {
      messages.push(msg)
    }

    // With videos=true & previews=false (default): directory + video URL only
    // (image URL is skipped via `continue` after yielding the video)
    expect(messages.length).toBeGreaterThanOrEqual(2)

    const directory = messages.find(m => m.type === 'directory')
    expect(directory).toBeDefined()
    if (directory && directory.type === 'directory') {
      expect(directory.metadata.username).toBe('reel_user')
      expect(directory.metadata.type).toBe('reel')
    }

    const urls = messages.filter(m => m.type === 'url')
    expect(urls.length).toBeGreaterThanOrEqual(1)

    // Should have at least one video_url type message
    const hasVideo = urls.some(
      m => m.type === 'url' && m.url.includes('.mp4'),
    )
    expect(hasVideo).toBe(true)
  })
})
