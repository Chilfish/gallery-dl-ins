import type { Message, Storage } from '../../types'
import { describe, expect, it } from 'vitest'
import { ConfigManager } from '../../config'
import { noopLogger } from '../../core/extractor'
import { InstagramUserExtractor } from '../../instagram/extractors'
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
})
