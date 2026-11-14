/**
 * Check specific missing fields from Instagram /v1/users/{id}/info/
 *
 * Usage: bun run scripts/check-missing-fields.ts <username>
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createFetchHttpClient, extractCsrf } from '../src/fetcher'
import { InstagramRestAPI } from '../src/instagram/api'

const envPath = resolve(import.meta.dirname!, '..', '.env')
const env: Record<string, string> = {}
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const [k, ...rest] = line.split('=')
  if (k && !k.startsWith('#'))
    env[k] = rest.join('=')
}

const username = process.argv[2] || 'meeeei.gt'

const api = new InstagramRestAPI({
  http: createFetchHttpClient({ cookie: env.INSTAGRAM_COOKIES! }),
  root: 'https://www.instagram.com',
  csrfToken: {
    value: extractCsrf(env.INSTAGRAM_COOKIES!),
  },
  wwwClaim: { value: '' },
  cursor: { value: null },
})

const user = await api.userByScreenName(username)
const full = await api.userById(user.id ?? user.pk) as any

console.log('== ProfileUser FIELD ANALYSIS for', username, '==\n')

const fields: Array<{
  name: string
  required: string
  sdkField: string
  apiField: string
  value: any
  verdict: string
}> = [
  {
    name: 'createdAt',
    required: 'string | Date',
    sdkField: '—',
    apiField: 'N/A',
    value: full.created_at ?? full.date_joined ?? full.created_time ?? 'NOT FOUND',
    verdict: '',
  },
  {
    name: 'profileBanner',
    required: 'string | null',
    sdkField: '—',
    apiField: 'N/A (Instagram has no banner)',
    value: null,
    verdict: '',
  },
  {
    name: 'fullName',
    required: 'string | null',
    sdkField: 'full_name',
    apiField: 'full_name',
    value: full.full_name,
    verdict: '',
  },
  {
    name: 'profileImage',
    required: 'string | null',
    sdkField: 'hd_profile_pic_url_info.url',
    apiField: 'hd_profile_pic_url_info',
    value: full.hd_profile_pic_url_info?.url,
    verdict: '',
  },
  {
    name: 'isVerified',
    required: 'boolean',
    sdkField: 'is_verified',
    apiField: 'is_verified',
    value: full.is_verified,
    verdict: '',
  },
  {
    name: 'userName',
    required: 'string',
    sdkField: 'username',
    apiField: 'username',
    value: full.username,
    verdict: '',
  },
  {
    name: 'description',
    required: 'string',
    sdkField: 'biography',
    apiField: 'biography',
    value: full.biography,
    verdict: '',
  },
  {
    name: 'location',
    required: '{ location?: string } | null',
    sdkField: '— (not in InstagramUser)',
    apiField: 'city_name',
    value: full.city_name,
    verdict: '',
  },
  {
    name: 'birthdayString',
    required: 'string | null',
    sdkField: '—',
    apiField: 'N/A',
    value: full.birthday ?? full.birthday_string ?? full.date_of_birth ?? 'NOT FOUND',
    verdict: '',
  },
  {
    name: 'url',
    required: 'string | null',
    sdkField: 'external_url',
    apiField: 'external_url',
    value: full.external_url,
    verdict: '',
  },
  {
    name: 'followingsCount',
    required: 'number | null',
    sdkField: 'following_count',
    apiField: 'following_count',
    value: full.following_count,
    verdict: '',
  },
  {
    name: 'followersCount',
    required: 'number | null',
    sdkField: 'follower_count',
    apiField: 'follower_count',
    value: full.follower_count,
    verdict: '',
  },
  {
    name: 'statusesCount',
    required: 'number | null',
    sdkField: 'media_count',
    apiField: 'media_count',
    value: full.media_count,
    verdict: '',
  },
]

// Compute verdicts
for (const f of fields) {
  if (typeof f.value === 'string' && f.value === 'NOT FOUND') {
    f.verdict = '❌ API 不返回此字段'
  }
  else if (f.value === null && f.name === 'profileBanner') {
    f.verdict = '❌ Instagram 无封面图概念（非 Twitter/X）'
  }
  else if (f.sdkField.startsWith('—')) {
    f.verdict = f.value != null && f.value !== ''
      ? '⚠️ API 有数据但 SDK 未提取'
      : '⚠️ 此用户未设置，但 API 支持'
  }
  else {
    f.verdict = '✅ 已覆盖'
  }
}

console.log('Field           | Required        | SDK Source                          | API Raw Value                                   | Verdict')
console.log('-'.repeat(140))
for (const f of fields) {
  const name = f.name.padEnd(16)
  const req = f.required.padEnd(16)
  const sdk = f.sdkField.padEnd(38)
  const val = String(f.value ?? '(null)').slice(0, 50).padEnd(50)
  console.log(`${name}| ${req}| ${sdk}| ${val}| ${f.verdict}`)
}

console.log('\n== ADDITIONAL FIELDS IN API BUT NOT IN InstagramUser TYPE ==')
const sdkFields = new Set([
  'pk',
  'id',
  'username',
  'full_name',
  'is_private',
  'profile_pic_url',
  'profile_pic_url_hd',
  'hd_profile_pic_url_info',
  'hd_profile_pic_versions',
  'profile_pic_id',
  'edge_owner_to_timeline_media',
  'edge_felix_video_timeline',
  'edge_saved_media',
  'edge_mutual_followed_by',
  'edge_follow',
  'edge_followed_by',
  'edge_media_collections',
  'followed_by_viewer',
  'is_verified',
])
const extraFields = Object.keys(full).filter(k => !sdkFields.has(k) && !k.startsWith('_'))
console.log(extraFields.filter((k) => {
  const v = full[k]
  return (v != null && v !== '' && v !== false && v !== 0 && !Array.isArray(v)) || typeof v === 'object'
}).join(', '))

console.log('\n== SUMMARY ==')
console.log('Missing from SDK InstagramUser type:')
console.log('  • city_name — location city (already in API response)')
console.log('  • address_street — street address (mainly for business accounts)')
console.log('  • category — business/professional category name')
console.log('  • biography_with_entities — structured bio with entities')
console.log('  • bio_links — multiple links-in-bio')
console.log('  • pronouns — user pronouns')
console.log('  • is_business / account_type — account type classification')
console.log('  • external_lynx_url — Instagram-wrapped external URL')
console.log('')
console.log('Cannot provide (Instagram API limitation):')
console.log('  • createdAt — Instagram does not expose creation date via public API')
console.log('  • profileBanner — Instagram does not have cover/banner images')
console.log('  • birthdayString — Instagram does not expose birthday via public API')
