/**
 * 导出 Instagram 用户的完整资料 + 全部帖子。
 *
 * Usage: bun run scripts/export-user.ts <instagram_user_url>
 * Example: bun run scripts/export-user.ts https://www.instagram.com/meeeei.gt/
 *
 * Output: data/<username>.json → { user: {...}, posts: [...] }
 *
 * 依赖：
 *   - INSTAGRAM_COOKIES（环境变量或项目根目录 .env 文件）
 */

import type { InstagramSDK } from '../src/sdk'
import type {
  ExtractorClass,
  Metadata,
  QueueMsg,
} from '../src/types'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createFetchHttpClient, extractCsrf } from '../src/fetcher'
import { InstagramRestAPI } from '../src/instagram/api'
import { createSDK } from '../src/node-factory'

// ═══════════════════════════════════════════════════════
//  类型定义
// ═══════════════════════════════════════════════════════

export interface ExportedUser {
  fullName: string
  profileImage: string
  isVerified: boolean
  userName: string
  description: string
  url: string
  followingsCount: number
  followersCount: number
  statusesCount: number
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
  story_link_url?: string
  story_link_display?: string
  story_link_title?: string
  story_link_type?: string
}

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

export interface ExportResult {
  user: ExportedUser
  posts: IGPost[]
}

// ═══════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════

const input = process.argv[2]
if (!input || input === '--help' || input === '-h') {
  console.log([
    'Usage: bun run scripts/export-user.ts <instagram_user_url>',
    '',
    '示例:',
    '  bun run scripts/export-user.ts https://www.instagram.com/meeeei.gt/',
    '  bun run scripts/export-user.ts @meeeei.gt',
    '',
    '输出: data/<username>.json',
    '',
    'Env:',
    '  INSTAGRAM_COOKIES  Required. "ds_user_id=...; sessionid=...; csrftoken=..."',
  ].join('\n'))
  process.exit(0)
}

// ═══════════════════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════════════════

/** 从 URL 中提取用户名 */
function extractUsername(raw: string): string {
  let cleaned = raw.trim()
  cleaned = cleaned.replace(/^@/, '')
  const match = cleaned.match(/instagram\.com\/([^/?]+)/)
  if (match)
    return match[1]!
  return cleaned.replace(/\/$/, '')
}

/** 加载 cookies（优先环境变量，回退 .env 文件） */
function loadCookies(): string {
  if (process.env.INSTAGRAM_COOKIES)
    return process.env.INSTAGRAM_COOKIES

  const envPath = resolve(import.meta.dirname!, '..', '.env')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0)
      continue
    const key = trimmed.slice(0, eqIdx)
    if (key === 'INSTAGRAM_COOKIES')
      return trimmed.slice(eqIdx + 1)
  }
  return ''
}

/** 将原始 API 返回的 user 对象清洗为 ExportedUser */
function normalizeUser(raw: Record<string, unknown>): ExportedUser {
  // hd 头像优先
  const hdUrl = (raw.hd_profile_pic_url_info as { url?: string } | undefined)?.url
  const profileImage = hdUrl
    ?? (raw.profile_pic_url_hd as string | undefined)
    ?? (raw.profile_pic_url as string | undefined)
    ?? ''

  // follow count 支持两种字段名
  const followingsCount
    = (raw.following_count as number)
      ?? (raw.edge_follow as { count?: number } | undefined)?.count
      ?? 0

  const followersCount
    = (raw.follower_count as number)
      ?? (raw.edge_followed_by as { count?: number } | undefined)?.count
      ?? 0

  const statusesCount
    = (raw.media_count as number)
      ?? (raw.edge_owner_to_timeline_media as { count?: number } | undefined)?.count
      ?? 0

  return {
    fullName: (raw.full_name as string) ?? '',
    profileImage,
    isVerified: (raw.is_verified as boolean) ?? false,
    userName: (raw.username as string) ?? '',
    description: (raw.biography as string) ?? '',
    url: (raw.external_url as string) ?? '',
    followingsCount,
    followersCount,
    statusesCount,
  }
}

// ═══════════════════════════════════════════════════════
//  帖子收集
// ═══════════════════════════════════════════════════════

/** 递归收集用户所有帖子 */
async function collectAll(
  ig: InstagramSDK,
  url: string,
): Promise<IGPost[]> {
  const all: IGPost[] = []

  for await (const msg of ig.extract(url)) {
    if (msg.type === 'directory') {
      const post = convertToIGPost(msg.metadata)
      if (post) {
        all.push(post)
        if (all.length % 10 === 0)
          console.log(`  ... ${all.length} 条`)
      }
    }
    else if (msg.type === 'queue') {
      const children = await handleQueue(ig, msg)
      all.push(...children)
    }
  }

  return all
}

/** 处理 Queue 消息——实例化子提取器并递归收集 */
async function handleQueue(
  ig: InstagramSDK,
  msg: QueueMsg,
): Promise<IGPost[]> {
  const ExtrClass = (msg.metadata as Record<string, unknown>)._extractor as
    | (ExtractorClass & {
      new (opts: Record<string, unknown>): {
        initialize: () => Promise<void>
        [Symbol.asyncIterator]: () => AsyncGenerator<Message, void, unknown>
      }
    })
    | undefined
  if (!ExtrClass)
    return []

  const url = msg.url
  let match = ExtrClass.pattern.exec(url)
  if (!match) {
    match = ExtrClass.pattern.exec(url.replace(/\/$/, ''))
  }
  if (!match)
    return []

  const child = Reflect.construct(ExtrClass, [{
    url,
    match,
    config: ig.config,
    http: ig.http,
    storage: ig.storage,
    log: ig.log,
  }]) as {
    initialize: () => Promise<void>
    [Symbol.asyncIterator]: () => AsyncGenerator<Message, void, unknown>
  }

  await child.initialize()

  const posts: IGPost[] = []
  for await (const m of child) {
    if (m.type === 'directory') {
      const post = convertToIGPost(m.metadata)
      if (post)
        posts.push(post)
    }
  }

  return posts
}

interface Message {
  type: string
  metadata: Metadata
  url: string
}

/** 将提取器的 ParsedPost metadata 转换为 IGPost */
function convertToIGPost(meta: Metadata): IGPost | null {
  const files = (meta._files as Record<string, unknown>[]) ?? []
  if (files.length === 0)
    return null

  const user = meta.user as Record<string, unknown> | undefined

  // 头像
  const avatar: string | undefined
    = (user?.hd_profile_pic_url_info as { url?: string } | undefined)?.url
      ?? (user?.profile_pic_url_hd as string | undefined)
      ?? (user?.profile_pic_url as string | undefined)
      ?? (meta.profile_pic_url_hd as string | undefined)
      ?? (meta.profile_pic_url as string | undefined)

  // 音频
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
    tagged_users: (f.tagged_users as unknown[] | undefined)?.length
      ? f.tagged_users as IGMedia['tagged_users']
      : undefined,
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
    location_name:
      (meta.location_slug as string | undefined)
      ?? (meta.location_name as string | undefined),
    coauthors: meta.coauthors as IGPost['coauthors'],
    verified: (user?.is_verified ?? meta.is_verified) as boolean | undefined,
    audio,
  }
}

// ═══════════════════════════════════════════════════════
//  主流程
// ═══════════════════════════════════════════════════════

async function main(): Promise<void> {
  const username = extractUsername(input)
  const userUrl = `https://www.instagram.com/${username}/`

  // ── 加载 cookies ──
  const cookies = loadCookies()
  if (!cookies) {
    console.error('❌ INSTAGRAM_COOKIES 未设置（环境变量 / .env 文件）')
    process.exit(1)
  }

  // ── 创建 SDK ──
  const ig = await createSDK({ cookies })
  ig.config.set('extractor.instagram.user.include', 'all')

  // ── 创建 REST API ──
  const http = createFetchHttpClient({ cookie: cookies })
  const csrf = extractCsrf(cookies)
  const restApi = new InstagramRestAPI({
    http,
    root: 'https://www.instagram.com',
    csrfToken: { value: csrf },
    wwwClaim: { value: '' },
    cursor: { value: null },
  })

  // ── 1. 获取用户资料 ──
  console.log(`\n📡 查询用户: ${username}...`)
  let userRaw: Record<string, unknown>

  try {
    // 先解析用户名 → ID
    const resolved = await restApi.userByScreenName(username)
    const uid = resolved.id ?? resolved.pk
    if (!uid)
      throw new Error('无法获取用户 ID')

    // 获取完整资料
    userRaw = (await restApi.userById(uid)) as unknown as Record<string, unknown>
    console.log(`✅ 用户资料获取成功`)
  }
  catch (e: any) {
    console.error(`❌ 获取用户资料失败: ${e.message}`)
    process.exit(1)
  }

  const user = normalizeUser(userRaw)

  // ── 2. 收集帖子 ──
  console.log(`\n🔍 提取帖子: ${userUrl}`)
  const posts = await collectAll(ig, userUrl)
  console.log(`✅ 收集完成: ${posts.length} 个帖子`)

  // ── 3. 合并输出 ──
  const result: ExportResult = { user, posts }
  const json = JSON.stringify(result, null, 2)
  const outPath = `data/${username}.json`

  mkdirSync('data', { recursive: true })
  writeFileSync(outPath, json)
  console.log(`\n📄 输出: ${outPath} (${(json.length / 1024).toFixed(1)} KB)`)
}

main().catch((err) => {
  console.error('💥 致命错误:', err)
  process.exit(1)
})
