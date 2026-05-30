/**
 * 基础示例：提取单个帖子的所有媒体 URL 和元数据。
 *
 * 运行：
 *   bun examples/basic-extract.ts
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

// 替换为任意 Instagram 帖子链接
const postUrl = 'https://www.instagram.com/p/DY1p3ufmcBS/?img_index=1'

console.log(`📸 正在提取: ${postUrl}\n`)

let mediaCount = 0

for await (const msg of ig.extract(postUrl)) {
  switch (msg.type) {
    case 'directory':
      console.log(`📁 目录: ${msg.metadata.post_id} (by @${msg.metadata.username})`)
      break
    case 'url':
      mediaCount++
      console.log(`  [${mediaCount}] ${msg.metadata.media_type ?? 'media'}: ${msg.url}`)
      console.log(`       尺寸: ${msg.metadata.width ?? '?'}×${msg.metadata.height ?? '?'}`)
      break
    case 'queue':
      console.log(`  ↳ 递归提取: ${msg.url}`)
      break
  }
}

console.log(`\n✅ 完成，共 ${mediaCount} 个媒体文件`)
