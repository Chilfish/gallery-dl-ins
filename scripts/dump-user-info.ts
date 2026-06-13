/**
 * Dump raw Instagram /v1/users/{id}/info/ API response for a given username.
 *
 * Usage: bun run scripts/dump-user-info.ts <username>
 * Example: bun run scripts/dump-user-info.ts meeeei.gt
 *
 * Reads INSTAGRAM_COOKIES from .env.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

import { resolve } from 'node:path'

// Actually, let's use the extractor approach instead — it's cleaner.
// We'll use InstagramInfoExtractor directly.

import { createFetchHttpClient, extractCsrf } from '../src/fetcher'
import { InstagramRestAPI } from '../src/instagram/api'
// ── Create SDK ──
import { createSDK } from '../src/node-factory' // Not directly accessible, use internal

// ── Load .env ──
const envPath = resolve(import.meta.dirname!, '..', '.env')
const envContent = readFileSync(envPath, 'utf-8')
const env: Record<string, string> = {}
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#'))
    continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx < 0)
    continue
  env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
}

const cookies = env.INSTAGRAM_COOKIES
if (!cookies) {
  console.error('❌ INSTAGRAM_COOKIES not found in .env')
  process.exit(1)
}

// ── Parse args ──
const username = process.argv[2]
if (!username) {
  console.error('Usage: bun run scripts/dump-user-info.ts <username>')
  process.exit(1)
}

const ig = await createSDK({ cookies })

// ── Resolve user ID ──
const _api = ig as any
const _userId = await (ig as any).config

const http = createFetchHttpClient({ cookie: cookies })
const csrf = extractCsrf(cookies)

const restApi = new InstagramRestAPI({
  http,
  root: 'https://www.instagram.com',
  csrfToken: { value: csrf },
  wwwClaim: { value: '' },
  cursor: { value: null },
})

console.log(`\n📡 Resolving user: ${username}...\n`)

// Step 1: Resolve username → ID
let user: any
try {
  user = await restApi.userByScreenName(username)
  console.log('✅ userByScreenName resolved:')
  console.log(JSON.stringify(user, null, 2))
}
catch (e: any) {
  console.error(`❌ userByScreenName failed: ${e.message}`)
  process.exit(1)
}

const uid = user.id ?? user.pk
console.log(`\n📡 Fetching full profile via /v1/users/${uid}/info/...\n`)

// Step 2: Get full profile data
try {
  const fullUser = await restApi.userById(uid)
  console.log('✅ Raw userById response:')
  console.log(JSON.stringify(fullUser, null, 2))

  // Step 3: Summary — what's available?
  console.log(`\n${'='.repeat(60)}`)
  console.log('📊 FIELD COMPARISON: ProfileUser downstream vs SDK current\n')

  const ur = fullUser as any

  const checks: Array<{ field: string, sdk: string, value: any }> = [
    { field: 'createdAt', sdk: ur.created_at ?? ur.created_time ?? ur.date_joined ?? '❌ MISSING', value: null },
    { field: 'profileBanner', sdk: ur.profile_banner_url ?? ur.hd_profile_pic_url_info?.url ?? '❌ MISSING', value: null },
    { field: 'fullName', sdk: ur.full_name ?? '❌ MISSING', value: null },
    { field: 'profileImage', sdk: ur.hd_profile_pic_url_info?.url ?? ur.profile_pic_url_hd ?? ur.profile_pic_url ?? '❌ MISSING', value: null },
    { field: 'isVerified', sdk: ur.is_verified ?? '❌ MISSING', value: null },
    { field: 'userName', sdk: ur.username ?? '❌ MISSING', value: null },
    { field: 'description', sdk: ur.biography ?? '❌ MISSING', value: null },
    { field: 'location', sdk: ur.location ?? ur.address_street ?? ur.city_name ?? '❌ MISSING', value: null },
    { field: 'birthdayString', sdk: ur.birthday ?? ur.birthday_string ?? ur.date_of_birth ?? '❌ MISSING', value: null },
    { field: 'url', sdk: ur.external_url ?? '❌ MISSING', value: null },
    { field: 'followingsCount', sdk: ur.following_count ?? ur.edge_follow?.count ?? '❌ MISSING', value: null },
    { field: 'followersCount', sdk: ur.follower_count ?? ur.edge_followed_by?.count ?? '❌ MISSING', value: null },
    { field: 'statusesCount', sdk: ur.media_count ?? ur.edge_owner_to_timeline_media?.count ?? '❌ MISSING', value: null },
  ]

  console.log('Field              | SDK Source                            | Available?')
  console.log('-'.repeat(80))
  for (const c of checks) {
    const pad = c.field.padEnd(20)
    const val = typeof c.sdk === 'string' && c.sdk.startsWith('❌') ? c.sdk : '✅'
    const preview = typeof c.sdk === 'string' && c.sdk.length > 40
      ? `${c.sdk.slice(0, 40)}…`
      : String(c.sdk)
    console.log(`${pad}| ${preview.padEnd(50)}| ${val}`)
  }

  // Also dump all top-level keys of the raw response
  console.log(`\n${'='.repeat(60)}`)
  console.log('🔑 ALL top-level keys in /v1/users/{id}/info/ response:')
  console.log(Object.keys(fullUser).sort().join(', '))

  const pickedUser: ProfileUser = {
    fullName: fullUser.full_name,
    profileImage: fullUser.profile_pic_url,
    isVerified: fullUser.is_verified,
    userName: fullUser.username,
    description: fullUser.biography,
    url: fullUser.external_url,
    followingsCount: fullUser.following_count,
    followersCount: fullUser.follower_count,
    statusesCount: fullUser.media_count,
  }
  await writeFile(`data/${username}.json`, JSON.stringify(pickedUser, null, 2))
}
catch (e: any) {
  console.error(`❌ userById failed: ${e.message}`)
  process.exit(1)
}

interface ProfileUser {
  fullName?: string | null
  profileImage?: string | null
  isVerified?: boolean
  userName: string
  description?: string
  url?: string | null
  followingsCount?: number | null
  followersCount?: number | null
  statusesCount?: number | null
}
