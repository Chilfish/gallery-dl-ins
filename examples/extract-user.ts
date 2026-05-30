/**
 * 用户主页提取示例：下载用户最近 N 条帖子。
 *
 * 运行：
 *   bun examples/extract-user.ts
 *
 * 需要先设置 .env 中的 INSTAGRAM_COOKIES。
 */

import { createSDK } from '../node'

const COOKIES = process.env.INSTAGRAM_COOKIES

if (!COOKIES) {
  console.error('请在 .env 文件中设置 INSTAGRAM_COOKIES')
  process.exit(1)
}

const ig = await createSDK({ cookies: COOKIES })

// 替换为目标用户名
const userUrl = 'https://www.instagram.com/instagram/'

console.log(`👤 正在提取用户帖子: ${userUrl}\n`)

let postCount = 0
let totalMedia = 0

for await (const msg of ig.extract(userUrl)) {
  if (msg.type === 'directory') {
    postCount++
    console.log(`📝 帖子 #${postCount}: ${msg.metadata.post_id}`)
    const caption = msg.metadata.caption as string | undefined
    if (caption) {
      console.log(`   ${caption.slice(0, 80)}…`)
    }
  }
  else if (msg.type === 'url') {
    totalMedia++
  }
}

console.log(`\n✅ 共提取 ${postCount} 个帖子，${totalMedia} 个媒体文件`)
