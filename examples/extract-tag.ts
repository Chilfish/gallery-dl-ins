/**
 * hashtag 提取示例：按标签搜索并提取帖子。
 *
 * 运行：
 *   bun examples/extract-tag.ts
 *
 * 需要先设置 .env 中的 INSTAGRAM_COOKIES。
 */

import { createSDK } from '../index'

const COOKIES = process.env.INSTAGRAM_COOKIES

if (!COOKIES) {
  console.error('请在 .env 文件中设置 INSTAGRAM_COOKIES')
  process.exit(1)
}

const ig = await createSDK({ cookies: COOKIES })

const tagUrl = 'https://www.instagram.com/explore/tags/cats/'

console.log(`🏷️  正在提取标签: #cats\n`)

let postCount = 0
let mediaCount = 0

for await (const msg of ig.extract(tagUrl)) {
  if (msg.type === 'directory') {
    postCount++
    console.log(`📝 帖子 #${postCount}: @${msg.metadata.username}`)
  }
  else if (msg.type === 'url') {
    mediaCount++
  }
  else if (msg.type === 'queue') {
    console.log(`  ↳ 进入帖子详情…`)
  }
}

console.log(`\n✅ 共提取 ${postCount} 个帖子，${mediaCount} 个媒体文件`)
