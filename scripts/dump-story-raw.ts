/**
 * Dump raw Instagram story API response.
 *
 * Usage: INSTAGRAM_COOKIES="ds_user_id=...; sessionid=..." bun run scripts/dump-story-raw.ts
 */

import { ConfigManager } from '../src/config'
import { noopLogger } from '../src/core/extractor'
import { createFetchHttpClient, extractCsrf } from '../src/fetcher'
import { InstagramRestAPI } from '../src/instagram/api'

const STORY_USERNAME = 'takao_kanon'
const TARGET_MEDIA_ID = '3909946233037241800'

const cookies = process.env.INSTAGRAM_COOKIES
if (!cookies) {
  console.error('Set INSTAGRAM_COOKIES env var (ds_user_id=...; sessionid=...; csrftoken=...)')
  process.exit(1)
}

async function main() {
  const _config = new ConfigManager()
  const http = createFetchHttpClient({ cookie: cookies })
  const csrf = extractCsrf(cookies!) || ''
  const _log = {
    ...noopLogger,
    debug: console.log,
    info: console.log,
    warn: console.warn,
    error: console.error,
  }

  const api = new InstagramRestAPI({
    http,
    root: 'https://www.instagram.com',
    csrfToken: { value: csrf },
    wwwClaim: { value: '0' },
    cursor: { value: null },
  })

  // Get user ID from username
  const reelId = await api.userId(STORY_USERNAME)
  console.log('=== reelId ===')
  console.log(reelId)

  // Fetch reels media
  const reels = await api.reelsMedia([reelId])
  console.log('\n=== Top-level reel keys ===')
  if (reels.length > 0) {
    console.log(Object.keys(reels[0]!))

    const reel = reels[0]!
    const items = reel.items ?? []
    console.log(`\n=== items count: ${items.length} ===`)

    // Filter to target item if media ID is specified
    const targetItems = TARGET_MEDIA_ID
      ? items.filter((item: any) => item.pk === TARGET_MEDIA_ID)
      : items

    console.log(`Target items: ${targetItems.length}\n`)

    for (let i = 0; i < targetItems.length; i++) {
      const item = targetItems[i]!
      console.log(`========== Item ${i} ==========`)
      console.log(JSON.stringify(item, null, 2))
    }
  }
  else {
    console.log('No reels returned')
  }
}

main().catch(console.error)
