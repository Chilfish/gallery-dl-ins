import type { Message, Storage } from '../../src/types'
import { describe, expect, it } from 'vitest'
import { ConfigManager } from '../../src/config'
import { noopLogger } from '../../src/core/extractor'
import { DownloadJob } from '../../src/core/job'
import { InstagramUserExtractor } from '../../src/instagram/extractors'
import { MockHttpClient } from '../helpers/mock-http'

const mockStorage: Storage = {
  exists: async () => false,
  write: async () => {},
  mkdir: async () => {},
}

describe('instagramUserExtractor integration', () => {
  const url = 'https://www.instagram.com/watase_yuzuki/'

  it('yields queue messages for posts by default', async () => {
    const http = new MockHttpClient()

    const match = InstagramUserExtractor.pattern.exec(url)!
    const config = new ConfigManager()
    // Default include is 'posts'
    config.set('extractor.instagram.include', 'posts')

    const extractor = new InstagramUserExtractor({
      url,
      match,
      config,
      http,
      storage: mockStorage,
      log: noopLogger,
    })

    await extractor.initialize()
    const messages: Message[] = []
    for await (const msg of extractor) {
      messages.push(msg)
    }

    // With include=posts, should yield 1 queue message
    const queues = messages.filter(m => m.type === 'queue')
    expect(queues.length).toBe(1)
    if (queues[0] && queues[0].type === 'queue') {
      expect(queues[0].url).toContain('watase_yuzuki')
      expect(queues[0].url).toContain('posts')
    }
  })

  it('dispatches multiple categories with include=all', async () => {
    const http = new MockHttpClient()

    const match = InstagramUserExtractor.pattern.exec(url)!
    const config = new ConfigManager()
    config.set('extractor.instagram.include', 'all')

    const extractor = new InstagramUserExtractor({
      url,
      match,
      config,
      http,
      storage: mockStorage,
      log: noopLogger,
    })

    await extractor.initialize()
    const messages: Message[] = []
    for await (const msg of extractor) {
      messages.push(msg)
    }

    const queues = messages.filter(m => m.type === 'queue')
    // include=all → posts, reels, tagged, stories, highlights, info, avatar = 7
    expect(queues.length).toBe(7)
  })

  it('downloadJob processes queue messages and passes parent deps to children', async () => {
    const http = new MockHttpClient()
    // Mock endpoints that child extractors call during initialization
    http.add('/api/v1/feed/user/', { items: [], num_results: 0, more_available: false })
    http.add('/web/search/topsearch/', { users: [] })
    http.add('/api/v1/users/web_profile_info/', {
      data: {
        user: { pk: '123', id: '123', username: 'watase_yuzuki', full_name: 'Watase Yuzuki', is_private: false },
      },
    })

    const match = InstagramUserExtractor.pattern.exec(url)!
    const config = new ConfigManager()
    config.set('extractor.instagram.include', 'posts')

    const extractor = new InstagramUserExtractor({
      url,
      match,
      config,
      http,
      storage: mockStorage,
      log: noopLogger,
    })

    const job = new DownloadJob(extractor as any)
    ;(job as any).basePath = './test-output'
    const status = await job.run()

    // Should complete without error (the queue dispatch works even with 0 posts)
    expect(status).toBe(0)
  })
})
