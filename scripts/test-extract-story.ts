/**
 * Test SDK extract() with new story fields.
 *
 * Usage: INSTAGRAM_COOKIES="..." bun run scripts/test-extract-story.ts
 */

import { createSDK } from '../src/node-factory'

const STORY_URL = 'https://www.instagram.com/stories/takao_kanon/3909946233037241800/'

const cookies = process.env.INSTAGRAM_COOKIES
if (!cookies) {
  console.error('Set INSTAGRAM_COOKIES env var')
  process.exit(1)
}

async function main() {
  const ig = await createSDK({ cookies })

  for await (const msg of ig.extract(STORY_URL)) {
    if (msg.type === 'directory') {
      const m = msg.metadata as Record<string, unknown>
      console.log('=== Directory ===')
      console.log('  type:', m.type)
      console.log('  username:', m.username)
      console.log('  post_shortcode:', m.post_shortcode)
      console.log('  expires:', m.expires)
      console.log('  count:', m.count)

      const files = m._files as Array<Record<string, unknown>>
      if (files) {
        for (const f of files) {
          console.log('  --- File ---')
          console.log('    num:', f.num)
          console.log('    media_id:', f.media_id)
          console.log('    audio_title:', f.audio_title)
          console.log('    audio_artist:', f.audio_artist)
          console.log('    audio_duration:', f.audio_duration)
          console.log('    music_attribution:', f.music_attribution)
          console.log('    story_link_url:', f.story_link_url)
          console.log('    story_link_display:', f.story_link_display)
          console.log('    story_link_type:', f.story_link_type)
          console.log('    display_url:', (f.display_url as string)?.slice(0, 80))
        }
      }
    }
    if (msg.type === 'url') {
      const m = msg.metadata as Record<string, unknown>
      const isAudio = !!m.audio_url
      console.log(`  URL [${isAudio ? 'audio' : 'media'}]:`, (m.story_link_display as string) ?? (m.url as string)?.slice(0, 80))
    }
  }
}

main().catch(console.error)
