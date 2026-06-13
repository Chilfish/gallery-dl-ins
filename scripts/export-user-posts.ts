/**
 * 批量导出 Instagram 用户全部帖子为 IGPostData JSON。
 *
 * 输入用户主页 URL（或 @用户名），通过 SDK 递归提取所有帖子 (posts + reels + tagged)，
 * 清洗为标准 IGPost[] 格式输出。
 *
 * Usage:
 *   INSTAGRAM_COOKIES="..." bun run scripts/export-user-posts.ts <username_or_url> [--output file.json] [--limit N]
 *
 * 依赖 gallery-dl-ins SDK 的 ParsedPost → 自动映射到 anonTweet 的 IGPost 结构。
 */

import type { InstagramSDK } from '../src/sdk'
import type { ExtractorClass, Metadata, QueueMsg } from '../src/types'
import { createSDK } from '../src/node-factory'

/**
 * ============================================================
 *  目标类型 — 与 I:\dev\anonTweet\app\types\ins.ts 保持一致
 *  ============================================================
 */
export interface IGAudio {
  title?: string
  subtitle?: string
  artist?: string
  duration?: number
  cover_artwork_uri?: string
  cover_artwork_thumbnail_uri?: string
  has_lyrics?: boolean
  is_explicit?: boolean
}

export interface IGMedia {
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
  tagged_users?: { id: string, username: string, full_name: string }[]
  /** Story link sticker — 来自 ParsedMedia 扩展字段 */
  story_link_url?: string
  story_link_display?: string
  story_link_title?: string
  story_link_type?: string
}

export interface IGPost {
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
  location_name?: string
  coauthors?: { username: string, fullname: string }[]
  verified?: boolean
  audio?: IGAudio
  captionTranslation?: string
}

export type IGPostData = IGPost[]

// ─── CLI ───────────────────────────────────────────────

const args = process.argv.slice(2)
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log([
    'Usage: bun run scripts/export-user-posts.ts <username_or_url> [options]',
    '',
    'Options:',
    '  --output <path>   Output JSON file (default: ig-posts.json)',
    '  --limit <N>       Max posts to export',
    '',
    'Env:',
    '  INSTAGRAM_COOKIES  Required. "ds_user_id=...; sessionid=...; csrftoken=..."',
  ].join('\n'))
  process.exit(0)
}

const input = args[0]!
const outputIdx = args.indexOf('--output')
const outputPath = outputIdx >= 0 ? args[outputIdx + 1]! : 'ig-posts.json'
const limitIdx = args.indexOf('--limit')
const maxPosts = limitIdx >= 0 ? Number.parseInt(args[limitIdx + 1]!, 10) : undefined

const cookies = process.env.INSTAGRAM_COOKIES
if (!cookies) {
  console.error('❌ INSTAGRAM_COOKIES not set')
  process.exit(1)
}

// 规范化 URL
const userUrl = input.startsWith('http')
  ? input
  : `https://www.instagram.com/${input.replace(/^@/, '')}/`

// ─── 主流程 ────────────────────────────────────────────

async function main() {
  const ig = await createSDK({ cookies })

  // 设置 UserExtractor 拉取全部内容类型
  ig.config.set('extractor.instagram.user.include', 'all')

  console.log(`🔍 提取: ${userUrl}`)

  const posts = await collectAll(ig, userUrl, maxPosts)

  console.log(`✅ 收集完成: ${posts.length} 个帖子`)

  const json = JSON.stringify(posts, null, 2)
  await Bun.write(outputPath, json)
  console.log(`📄 写入: ${outputPath} (${(json.length / 1024).toFixed(1)} KB)`)
}

/**
 * 递归收集所有帖子。
 * - Directory 消息 → 清洗为 IGPost
 * - Queue 消息 → 递归启动子提取器
 * - `remaining` 控制总量上限，穿透到子提取器中
 */
async function collectAll(
  ig: InstagramSDK,
  url: string,
  remaining?: number,
): Promise<IGPost[]> {
  const all: IGPost[] = []
  const max = remaining

  for await (const msg of ig.extract(url)) {
    if (msg.type === 'directory') {
      const post = convertToIGPost(msg.metadata)
      if (post) {
        all.push(post)
        if (all.length % 10 === 0)
          console.log(`  ... ${all.length} 条`)
        if (max !== undefined && all.length >= max) {
          console.log(`  ⚠️ 已达上限 ${max}`)
          return all
        }
      }
    }
    else if (msg.type === 'queue') {
      if (max !== undefined && all.length >= max)
        return all
      const budget = max !== undefined ? max - all.length : undefined
      const children = await handleQueue(ig, msg, budget)
      all.push(...children)
    }
  }

  return all
}

/**
 * 处理 Queue 消息 — 实例化子提取器（Posts / Reels / Tagged / Stories / Highlights）
 * 并递归收集其 Directory 消息。
 */
async function handleQueue(
  ig: InstagramSDK,
  msg: QueueMsg,
  remaining?: number,
): Promise<IGPost[]> {
  const ExtrClass = msg.metadata._extractor as
    | (ExtractorClass & { new (opts: Record<string, unknown>): { initialize: () => Promise<void>, [Symbol.asyncIterator]: () => AsyncGenerator<Message, void, unknown> } })
    | undefined
  if (!ExtrClass)
    return []

  // UserExtractor 产的 URL 可能带尾部斜杠，子提取器 pattern 可能不匹配
  const url = msg.url
  let match = ExtrClass.pattern.exec(url)
  if (!match) {
    match = ExtrClass.pattern.exec(url.replace(/\/$/, ''))
  }
  if (!match)
    return []

  // 复用 SDK 的 config / http / storage / log 构造子提取器
  const child = Reflect.construct(ExtrClass, [{
    url,
    match,
    config: ig.config,
    http: ig.http,
    storage: ig.storage,
    log: ig.log,
  }]) as { initialize: () => Promise<void>, [Symbol.asyncIterator]: () => AsyncGenerator<Message, void, unknown> }

  await child.initialize()

  const posts: IGPost[] = []
  for await (const m of child) {
    if (remaining !== undefined && posts.length >= remaining)
      break
    if (m.type === 'directory') {
      const post = convertToIGPost(m.metadata)
      if (post)
        posts.push(post)
    }
    // 子提取器不会产出 Queue（叶子节点），忽略
  }

  return posts
}

// ─── 清洗函数 ───────────────────────────────────────────

/** 将 ParsedPost metadata 转换为 IGPost */
function convertToIGPost(meta: Metadata): IGPost | null {
  const files = (meta._files as Record<string, unknown>[]) ?? []
  if (files.length === 0)
    return null

  // user 来自 REST 响应的 post.user（帖子作者），对于用户自己的帖子就是本人
  const user = meta.user as Record<string, unknown> | undefined

  const avatar: string | undefined
    = (user?.hd_profile_pic_url_info as { url?: string } | undefined)?.url
      ?? (user?.profile_pic_url_hd as string | undefined)
      ?? (user?.profile_pic_url as string | undefined)
    // InfoExtractor 产出扁平化的 profile_pic_url_hd
      ?? (meta.profile_pic_url_hd as string | undefined)
      ?? (meta.profile_pic_url as string | undefined)

  // 音频信息 — 从第一个含 audio_url / audio_title 的 media 中取
  let audio: IGAudio | undefined
  for (const f of files) {
    if (f.audio_title || f.audio_url) {
      audio = {
        title: f.audio_title as string | undefined,
        subtitle: f.audio_subtitle as string | undefined,
        artist: f.audio_artist as string | undefined,
        duration: f.audio_duration as number | undefined,
        cover_artwork_uri: f.audio_cover_artwork_uri as string | undefined,
        cover_artwork_thumbnail_uri: f.audio_cover_artwork_thumbnail_uri as string | undefined,
        has_lyrics: f.audio_has_lyrics as boolean | undefined,
        is_explicit: f.audio_is_explicit as boolean | undefined,
      }
      break
    }
  }

  // 媒体列表
  const media: IGMedia[] = files.map(f => ({
    num: f.num as number,
    media_id: f.media_id as string,
    shortcode: f.shortcode as string | undefined,
    display_url: f.display_url as string,
    video_url: (f.video_url as string) ?? null,
    width: f.width as number,
    height: f.height as number,
    width_original: f.width_original as number | undefined,
    height_original: f.height_original as number | undefined,
    type: f.video_url ? 'video' : 'photo',
    tagged_users: (f.tagged_users as unknown[] | undefined)?.length ? f.tagged_users as IGMedia['tagged_users'] : undefined,
    story_link_url: f.story_link_url as string | undefined,
    story_link_display: f.story_link_display as string | undefined,
    story_link_title: f.story_link_title as string | undefined,
    story_link_type: f.story_link_type as string | undefined,
  }))

  return {
    id: (meta.post_shortcode as string) ?? '',
    post_id: (meta.post_id as string) ?? '',
    url: (meta.post_url as string) ?? '',
    username: (meta.username as string) ?? '',
    fullname: (meta.fullname as string) ?? '',
    description: (meta.description as string) ?? '',
    tags: meta.tags as string[] | undefined,
    likes: (meta.likes as number) ?? 0,
    type: (meta.type as IGPost['type']) ?? 'post',
    media,
    avatar_url: avatar,
    created_at: (meta.post_date as string) ?? (meta.date as string),
    location_name: (meta.location_slug as string | undefined)
      ?? (meta.location_name as string | undefined),
    coauthors: meta.coauthors as IGPost['coauthors'],
    verified: (user?.is_verified ?? meta.is_verified) as boolean | undefined,
    audio,
  }
}

// ─── 入口 ───────────────────────────────────────────────

main().catch((err) => {
  console.error('💥 致命错误:', err)
  process.exit(1)
})
