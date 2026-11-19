import type { HttpClient, Message, Storage } from '../../src/types'
import { describe, expect, it } from 'vitest'
import { ConfigManager } from '../../src/config'
import { noopLogger } from '../../src/core/extractor'
import { InstagramPostExtractor } from '../../src/instagram/extractors'
import { MockHttpClient } from '../helpers/mock-http'

// Minimal no-op storage
const mockStorage: Storage = {
  exists: async () => false,
  write: async () => {},
  mkdir: async () => {},
}

const mockUser = {
  pk: '12345',
  username: 'test_user',
  full_name: 'Test User',
  is_private: false,
  profile_pic_url: 'https://example.com/pic.jpg',
}

describe('instagramPostExtractor integration', () => {
  const url = 'https://www.instagram.com/p/DY1p3ufmcBS/'

  const mockPost = {
    items: [
      {
        pk: '3400000000000000001',
        code: 'DY1p3ufmcBS',
        taken_at: 1717000000,
        user: mockUser,
        caption: { text: 'A beautiful photo #sunset' },
        like_count: 42,
        image_versions2: {
          candidates: [
            {
              url: 'https://example.com/photo_1080.jpg',
              width: 1080,
              height: 1350,
              url_signature: {},
            },
            {
              url: 'https://example.com/photo_480.jpg',
              width: 480,
              height: 600,
              url_signature: {},
            },
          ],
        },
        media_type: 1,
        comment_count: 3,
        has_liked: false,
      },
    ],
    num_results: 1,
    more_available: false,
  }

  it('yields directory and url messages for a single-image post', async () => {
    const http = new MockHttpClient()
      .add('/api/v1/media/', mockPost)

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

    // Should yield: 1 directory + N url messages (one per media file)
    expect(messages.length).toBeGreaterThanOrEqual(2)

    const directory = messages.find(m => m.type === 'directory')
    expect(directory).toBeDefined()
    if (directory && directory.type === 'directory') {
      expect(directory.metadata.username).toBe('test_user')
      expect(directory.metadata.post_shortcode).toBe('DY1p3ufmcBS')
    }

    const urls = messages.filter(m => m.type === 'url')
    expect(urls.length).toBeGreaterThanOrEqual(1)
    if (urls[0] && urls[0].type === 'url') {
      expect(urls[0].url).toContain('photo')
    }
  })

  it('throws on login redirect', async () => {
    const mockClient = new MockHttpClient()
      .add('/api/v1/media/', {}, 302)

    // Wrap request to simulate login redirect URL in the response
    const redirectUrl = 'https://www.instagram.com/accounts/login/?next=/p/DY1p3ufmcBS/'
    const http: HttpClient = {
      request: async <T>(config: Parameters<MockHttpClient['request']>[0]) => {
        const resp = await mockClient.request<T>(config)
        return { ...resp, url: redirectUrl }
      },
    }

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
    await expect(async () => {
      for await (const _ of extractor) {
        // should throw before yielding
      }
    }).rejects.toThrow(/login/)
  })
})
