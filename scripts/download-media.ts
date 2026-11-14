/**
 * 读取 export-user / export-user-posts 产出的 JSON，并发下载所有媒体到本地，
 * 并将原 JSON 中的媒体链接替换为 CDN 格式。
 *
 * 兼容两种输入格式：
 *   - 旧格式: IGPost[]（纯帖子数组）
 *   - 新格式: { user: {...}, posts: IGPost[] }
 *
 * CDN 格式:
 *   https://s3.chilfish.top/instagram/${username}/${postId}-{idx}.${ext}
 *
 * Usage:
 *   bun run scripts/download-media.ts <input.json> [--concurrency N] [--outdir data]
 *
 * 产出:
 *   {outdir}/instagram/{username}/DZXRbpLBbu6-1.jpg ...
 *   {input}.cdn.json — 替换后的 JSON（格式与输入一致）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'

// ─── CLI ───────────────────────────────────────────────

const args = process.argv.slice(2)
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log([
    'Usage: bun run scripts/download-media.ts <input.json> [options]',
    '',
    'Options:',
    '  --concurrency N   Max parallel downloads (default: 5)',
    '  --outdir <dir>    Output root directory (default: data)',
  ].join('\n'))
  process.exit(0)
}

const inputPath = args[0]!
const concIdx = args.indexOf('--concurrency')
const concurrency = concIdx >= 0
  ? Number.parseInt(args[concIdx + 1]!, 10)
  : 16
const outIdx = args.indexOf('--outdir')
const outRoot = outIdx >= 0
  ? args[outIdx + 1]!
  : 'data'

// ─── 类型 ───────────────────────────────────────────────

interface IGMedia {
  num: number
  media_id: string
  shortcode?: string
  display_url: string
  video_url?: string | null
  width: number
  height: number
  width_original?: number
  height_original?: number
  type: 'photo' | 'video'
}

interface IGPost {
  id: string
  post_id: string
  url: string
  username: string
  fullname: string
  description: string
  tags?: string[]
  likes: number
  type: 'post' | 'reel' | 'story' | 'highlight'
  media: IGMedia[]
  avatar_url?: string
  created_at?: string
  [k: string]: unknown
}

/** 新格式: export-user 产出 */
interface ExportResult {
  user: {
    userName: string
    profileImage?: string
    [k: string]: unknown
  }
  posts: IGPost[]
}

interface DownloadTask {
  postIdx: number
  mediaIdx: number
  /** 要下载的实际 URL（video 优先） */
  srcUrl: string
  ext: string
  localPath: string
  cdnUrl: string
}

// ─── 主流程 ────────────────────────────────────────────

async function main() {
  // 1. 读取 JSON
  if (!existsSync(inputPath)) {
    console.error(`❌ 文件不存在: ${inputPath}`)
    process.exit(1)
  }
  const raw = readFileSync(inputPath, 'utf-8')
  const parsed: unknown = JSON.parse(raw)

  // 兼容两种格式
  let posts: IGPost[]
  let user: ExportResult['user'] | undefined
  const isNewFormat = (
    typeof parsed === 'object'
    && parsed !== null
    && !Array.isArray(parsed)
    && 'posts' in parsed
  )

  if (isNewFormat) {
    const data = parsed as ExportResult
    posts = data.posts
    user = data.user
  }
  else if (Array.isArray(parsed)) {
    posts = parsed as IGPost[]
  }
  else {
    console.error('❌ 无法识别的 JSON 格式（需要 IGPost[] 或 { user, posts }）')
    process.exit(1)
  }
  console.log(`📄 读取: ${posts.length} 个帖子`)

  // username 优先级：新格式 user.userName > 第一个帖子的 username
  const username = user?.userName ?? posts[0]?.username
  if (!username) {
    console.error('❌ JSON 中没有用户数据')
    process.exit(1)
  }

  // 2. 构建下载任务列表
  const baseDir = join(outRoot, 'instagram', username)
  mkdirSync(baseDir, { recursive: true })

  const tasks: DownloadTask[] = []

  for (let pi = 0; pi < posts.length; pi++) {
    const post = posts[pi]!
    for (let mi = 0; mi < post.media.length; mi++) {
      const m = post.media[mi]!
      // 有视频则下载视频，否则下载图片
      const srcUrl = m.video_url || m.display_url
      const ext = extractExt(srcUrl)
      const idx = mi + 1
      const filename = `${post.id}-${idx}.${ext}`
      const localPath = join(baseDir, filename)
      const cdnUrl = `https://s3.chilfish.top/instagram/${username}/${post.id}-${idx}.${ext}`

      tasks.push({
        postIdx: pi,
        mediaIdx: mi,
        srcUrl,
        ext,
        localPath,
        cdnUrl,
      })
    }
  }

  // 头像 — 优先用 user.profileImage（HD），否则从帖子取
  let avatarCdnUrl: string | undefined
  const avatarSrc = user?.profileImage
    ?? posts.find(p => p.avatar_url)?.avatar_url

  if (avatarSrc) {
    const avExt = extractExt(avatarSrc)
    const avFilename = `${username}.${avExt}`
    const avLocalPath = join(baseDir, avFilename)
    avatarCdnUrl = `https://s3.chilfish.top/instagram/${username}.${avExt}`
    // 插入队首优先下载
    tasks.unshift({
      postIdx: -1,
      mediaIdx: -1,
      srcUrl: avatarSrc,
      ext: avExt,
      localPath: avLocalPath,
      cdnUrl: avatarCdnUrl,
    })
  }

  const totalFiles = tasks.length
  console.log(`📦 ${totalFiles} 个文件待下载 (并发: ${concurrency})`)

  // 3. 并发下载
  const start = Date.now()
  let done = 0
  let failed = 0
  let downloadedBytes = 0

  // Instagram CDN 偶尔有 TLS 握手问题，放松校验 + 重试
  if (typeof process !== 'undefined') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }

  await pool(tasks, concurrency, async (task) => {
    // 跳过已存在的文件
    if (existsSync(task.localPath)) {
      done++
      logProgress(done, totalFiles, '⏭️')
      return
    }

    const maxRetries = 3
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const resp = await fetch(task.srcUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0',
          },
        })
        if (!resp.ok) {
          if (attempt === maxRetries) {
            console.error(`\n  ❌ HTTP ${resp.status}: ${task.srcUrl.slice(0, 80)}`)
            failed++
          }
          else {
            await sleep(1000 * attempt)
          }
          continue
        }

        const buf = await resp.arrayBuffer()
        writeFileSync(task.localPath, new Uint8Array(buf))
        downloadedBytes += buf.byteLength
        done++
        logProgress(done, totalFiles)
        break
      }
      catch (err) {
        if (attempt === maxRetries) {
          console.error(`\n  ❌ 下载失败 (×${maxRetries}): ${task.srcUrl.slice(0, 80)} — ${String(err)}`)
          failed++
        }
        else {
          await sleep(1000 * attempt)
        }
      }
    }
  })

  // 4. 替换 JSON 中的媒体链接
  for (const task of tasks) {
    // postIdx === -1 是头像任务，统一在后面处理
    if (task.postIdx === -1)
      continue
    const post = posts[task.postIdx]!
    const media = post.media[task.mediaIdx]!
    media.display_url = task.cdnUrl
    if (media.video_url) {
      media.video_url = task.cdnUrl
    }
  }

  // 替换所有 avatar_url
  if (avatarCdnUrl) {
    for (const post of posts) {
      if (post.avatar_url) {
        post.avatar_url = avatarCdnUrl
      }
    }
  }

  // 5. 输出替换后的 JSON
  const cdnJsonPath = inputPath.replace(/\.json$/, '.cdn.json')

  if (isNewFormat && user) {
    // 新格式：保留 user + posts
    user.profileImage = avatarCdnUrl ?? user.profileImage ?? ''
    writeFileSync(cdnJsonPath, JSON.stringify({ user, posts }, null, 2))
  }
  else {
    writeFileSync(cdnJsonPath, JSON.stringify(posts, null, 2))
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  console.log(`\n✅ 完成: ${done} 下载, ${failed} 失败, ${formatBytes(downloadedBytes)}, 耗时 ${elapsed}s`)
  console.log(`📄 CDN JSON → ${cdnJsonPath}`)
}

// ─── 工具 ───────────────────────────────────────────────

/** 从 URL 提取文件扩展名（去掉 query string） */
function extractExt(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = extname(pathname).replace(/^\./, '').toLowerCase()
    // 如果没有扩展名，默认 jpg
    return ext || 'jpg'
  }
  catch {
    return 'jpg'
  }
}

/** 并发池 */
async function pool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  const running: Promise<void>[] = []

  const next = async (): Promise<void> => {
    const item = queue.shift()
    if (!item)
      return
    const p = worker(item).finally(() => {
      const idx = running.indexOf(p)
      if (idx >= 0)
        running.splice(idx, 1)
    })
    running.push(p)
    if (running.length < concurrency && queue.length > 0) {
      await next()
    }
    await p
    await next()
  }

  // Start initial batch
  const initial = Math.min(concurrency, queue.length)
  await Promise.all(Array.from({ length: initial }, () => next()))
}

/** 进度显示（单行覆盖） */
function logProgress(done: number, total: number, prefix = '⬇️'): void {
  const pct = ((done / total) * 100).toFixed(0)
  process.stdout.write(`\r  ${prefix} ${done}/${total} (${pct}%)`)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── 入口 ───────────────────────────────────────────────

main().catch((err) => {
  console.error('💥 致命错误:', err)
  process.exit(1)
})
