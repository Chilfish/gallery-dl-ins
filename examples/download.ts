/**
 * 下载示例：将帖子的所有媒体下载到本地目录。
 *
 * 运行：
 *   bun examples/download.ts
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
const outputDir = './data/single-post'

console.log(`⬇️  正在下载: ${postUrl}`)
console.log(`📂 输出目录: ${outputDir}\n`)

const stats = await ig.download(postUrl, outputDir)

console.log(`✅ 下载完成!`)
console.log(`   帖子数: ${stats.posts}`)
console.log(`   文件数: ${stats.files}`)
console.log(`   总大小: ${(stats.bytes / 1024 / 1024).toFixed(2)} MB`)
