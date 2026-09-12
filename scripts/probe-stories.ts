/**
 * Instagram story 探针 — 逐场景验证并列出 story 数据。
 *
 * 场景:
 *   tray                  当前账号可见的 story 列表（关注的人 + 自己）
 *   user <username>       指定用户的当前 story
 *   story <url>           单条 story（URL 带 media_id 时按该 id 定位）
 *   highlights <username> 某用户的全部精选集
 *   highlight <url>       单个精选集
 *
 * Usage:
 *   bun run scripts/probe-stories.ts tray
 *   bun run scripts/probe-stories.ts user rin_.t710
 *   bun run scripts/probe-stories.ts story "https://www.instagram.com/stories/rin_.t710/3906328154789100102/"
 *   bun run scripts/probe-stories.ts highlights rin_.t710
 *   bun run scripts/probe-stories.ts highlight "https://www.instagram.com/stories/highlights/18104059936919418/"
 */

import { createFetchHttpClient, extractCsrf } from '../src/fetcher'
import { InstagramRestAPI } from '../src/instagram/api'
import { createSDK } from '../src/node-factory'

interface ReelItem {
  pk: string
  code?: string
  media_type?: number
  taken_at?: number
  expiring_at?: number
  story_link_url?: string
  image_versions2?: { candidates?: Array<{ url: string }> }
  video_versions?: Array<{ url: string }>
}

interface Reel {
  id: string | number
  title?: string
  media_count?: number
  seen?: number | null
  expiring_at?: number
  items?: ReelItem[]
  user?: { username?: string, full_name?: string }
}

interface TrayEntry {
  id: string | number
  media_count?: number
  media_ids?: Array<string | number>
  expiring_at?: number
  seen?: number
  user?: { username?: string, full_name?: string }
}

interface HighlightEntry {
  id: string
  title?: string
  media_count?: number
  user?: { username?: string }
}

function createApi(): InstagramRestAPI {
  const cookies = process.env.INSTAGRAM_COOKIES
  if (!cookies) {
    console.error('缺少 INSTAGRAM_COOKIES（.env 或环境变量）')
    process.exit(1)
  }
  return new InstagramRestAPI({
    http: createFetchHttpClient({ cookie: cookies }),
    root: 'https://www.instagram.com',
    csrfToken: { value: extractCsrf(cookies) },
    wwwClaim: { value: '0' },
    cursor: { value: null },
  })
}

function iso(sec: number | undefined): string {
  return sec ? new Date(sec * 1000).toISOString() : '-'
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

function printItems(reel: Reel): void {
  const items = reel.items ?? []
  const username = reel.user?.username ?? '-'
  console.log(`reel ${reel.id} @${username} title=${reel.title ?? '-'} media=${reel.media_count ?? items.length} seen=${reel.seen ?? '-'}`)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const kind = item.media_type === 2 ? 'video' : 'photo'
    const url = item.video_versions?.[0]?.url ?? item.image_versions2?.candidates?.[0]?.url
    console.log(`  [${i + 1}] ${kind} pk=${item.pk} code=${item.code ?? '-'} taken=${iso(item.taken_at)} expires=${iso(item.expiring_at)}`)
    if (item.story_link_url)
      console.log(`      link: ${item.story_link_url}`)
    if (url)
      console.log(`      media: ${url.slice(0, 100)}`)
  }
  if (!items.length)
    console.log('  (无 media)')
}

async function fetchReels(api: InstagramRestAPI, ids: Array<string | number>): Promise<Reel[]> {
  const reels: Reel[] = []
  for (const group of chunk(ids, 5))
    reels.push(...(await api.reelsMedia(group.map(String)) as unknown as Reel[]))
  return reels
}

async function cmdTray(api: InstagramRestAPI): Promise<void> {
  const tray = (await api.reelsTray()) as unknown as TrayEntry[]
  console.log(`可见 story 账号数: ${tray.length}\n`)
  if (!tray.length) {
    console.log('托盘为空（未关注任何有 story 的账号，或 cookie 无权限）')
    return
  }

  let reels: Reel[] = []
  try {
    reels = await fetchReels(api, tray.map(t => t.id))
  }
  catch (err) {
    console.log('取 media 失败:', err instanceof Error ? err.message : String(err))
  }
  const byId = new Map(reels.map(r => [String(r.id), r]))

  for (const entry of tray) {
    const mediaIds = entry.media_ids ?? []
    console.log(`@${entry.user?.username} (${entry.user?.full_name ?? ''})`)
    console.log(`  id=${entry.id} media=${entry.media_count ?? mediaIds.length} expiring=${iso(entry.expiring_at)} seen=${entry.seen ?? '-'}`)
    const reel = byId.get(String(entry.id))
    if (reel)
      printItems(reel)
    else
      console.log(`  media_ids: ${mediaIds.map(String).join(', ') || '(空)'}`)
    console.log()
  }
}

async function cmdUser(api: InstagramRestAPI, username: string): Promise<void> {
  const uid = await api.userId(username)
  console.log(`@${username} → uid ${uid}\n`)
  const reels = await fetchReels(api, [uid])
  if (!reels.length) {
    console.log('无 story（未发布 / 已过期 / 被限制）')
    return
  }
  for (const reel of reels)
    printItems(reel)
}

async function cmdHighlights(api: InstagramRestAPI, username: string): Promise<void> {
  const uid = await api.userId(username)
  const tray = (await api.highlightsTray(uid)) as unknown as HighlightEntry[]
  console.log(`@${username} → uid ${uid}，精选集 ${tray.length} 个\n`)
  if (!tray.length) {
    console.log('无精选集')
    return
  }

  const reels = await fetchReels(api, tray.map(h => h.id))
  const byId = new Map(reels.map(r => [String(r.id), r]))

  for (const hl of tray) {
    console.log(`[${hl.id}] ${hl.title ?? '(无标题)'} media=${hl.media_count ?? '-'}`)
    const reel = byId.get(String(hl.id))
    if (reel)
      printItems(reel)
    else
      console.log('  (未取到 media)')
    console.log()
  }
}

async function cmdExtract(url: string, expectedMediaId?: string): Promise<void> {
  const cookies = process.env.INSTAGRAM_COOKIES
  if (!cookies) {
    console.error('缺少 INSTAGRAM_COOKIES（.env 或环境变量）')
    process.exit(1)
  }
  const ig = await createSDK({ cookies })
  let directories = 0
  const urls: string[] = []

  for await (const msg of ig.extract(url)) {
    if (msg.type === 'directory') {
      directories++
      const m = msg.metadata as Record<string, unknown>
      const files = (m._files ?? []) as Array<Record<string, unknown>>
      console.log('DIRECTORY', JSON.stringify({
        type: m.type,
        username: m.username,
        post_shortcode: m.post_shortcode,
        post_id: m.post_id,
        post_url: m.post_url,
        count: m.count,
        expires: m.expires,
        highlight_title: m.highlight_title,
        media_ids: files.map(f => f.media_id),
      }, null, 2))
    }
    else if (msg.type === 'url') {
      const m = msg.metadata as Record<string, unknown>
      urls.push(String(m.media_id))
      console.log(`URL media_id=${m.media_id} num=${m.num} kind=${m.video_url ? 'video' : 'photo'}`)
    }
  }

  console.log(`\n共 ${directories} 个 directory，${urls.length} 个 media`)
  if (expectedMediaId && !urls.includes(expectedMediaId))
    console.log(`⚠️ URL 指定的 media_id ${expectedMediaId} 未出现在结果中（story 可能已过期）`)
}

function usage(): void {
  console.log([
    'Usage: bun run scripts/probe-stories.ts <command> [arg]',
    '',
    'Commands:',
    '  tray                  当前账号可见的 story 列表',
    '  user <username>       指定用户的当前 story',
    '  story <url>           单条 story URL',
    '  highlights <username> 某用户的全部精选集',
    '  highlight <url>       单个精选集 URL',
  ].join('\n'))
}

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2)
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    usage()
    return
  }

  const needArg = ['user', 'story', 'highlights', 'highlight']
  if (needArg.includes(command) && !arg) {
    console.error(`命令 ${command} 需要一个参数\n`)
    usage()
    process.exit(1)
  }
  if (command === 'tray') {
    await cmdTray(createApi())
    return
  }
  if (command === 'user') {
    await cmdUser(createApi(), arg!)
    return
  }
  if (command === 'highlights') {
    await cmdHighlights(createApi(), arg!)
    return
  }
  if (command === 'story') {
    const mediaId = arg!.match(/\/stories\/[^/]+\/(\d+)/)?.[1]
    await cmdExtract(arg!, mediaId)
    return
  }
  if (command === 'highlight') {
    await cmdExtract(arg!)
    return
  }

  console.error(`未知命令: ${command}\n`)
  usage()
  process.exit(1)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('💥', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
