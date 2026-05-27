#!/usr/bin/env node
/**
 * gdl-instagram — CLI entry point.
 *
 * Usage:
 *   gdl-instagram post <url> [options]
 *   gdl-instagram user <url> [options]
 *   gdl-instagram stories <url> [options]
 *   gdl-instagram highlights <url> [options]
 *   gdl-instagram tag <hashtag> [options]
 *   gdl-instagram saved [options]
 *   gdl-instagram info <url>
 *   gdl-instagram avatar <url>
 *
 * Every option is self-documented via ``--help``.
 */

import { Command } from 'commander'
import { ConfigManager } from '../config'
import { DownloadJob } from '../core/job'
import {
  InstagramAvatarExtractor,
  InstagramHighlightsExtractor,
  InstagramInfoExtractor,
  InstagramPostExtractor,
  InstagramSavedExtractor,
  InstagramStoriesExtractor,
  InstagramTagExtractor,
  InstagramUserExtractor,
} from '../instagram/extractors'
import { createHttpClient, createLogger, createStorage } from './adapter'

// ---------------------------------------------------------------------------
// Shared options — applied to all subcommands
// ---------------------------------------------------------------------------

interface GlobalOptions {
  sessionid?: string
  output?: string
  videos?: string
  previews?: string
  audio?: boolean
  maxPosts?: number
  cursor?: string
  orderPosts?: string
  orderFiles?: string
  staticVideos?: boolean
  api?: string
  verbose?: boolean
  include?: string
  split?: boolean
}

function addSharedOptions(cmd: Command): Command {
  return cmd
    .option(
      '--sessionid <cookie>',
      'Instagram sessionid cookie value (from browser)',
      process.env.INSTAGRAM_SESSIONID,
    )
    .option('-o, --output <dir>', 'Output directory', './gallery-dl')
    .option(
      '--videos <mode>',
      'Download videos: true, false, or merged (yt-dlp)',
      'true',
    )
    .option(
      '--previews <types>',
      'Download only previews: video,audio (comma-separated)',
    )
    .option('--audio', 'Download standalone audio tracks', false)
    .option('--max-posts <n>', 'Maximum number of posts to download', Number.parseInt)
    .option(
      '--cursor <cursor>',
      'Resume from pagination cursor (see output of previous run)',
    )
    .option(
      '--order-posts <order>',
      'Post ordering: asc, desc, id, id_asc, id_desc',
    )
    .option(
      '--order-files <order>',
      'File ordering: r, d (reverse), or empty for natural order',
    )
    .option(
      '--static-videos',
      'Download static video cover images instead of actual videos',
      false,
    )
    .option(
      '--no-static-videos',
      'Do not force static video covers (download real videos)',
    )
    .option('--api <backend>', 'API backend: rest (default) or graphql', 'rest')
    .option('-v, --verbose', 'Verbose debug output', false)
    .option(
      '--include <list>',
      'For user: comma-separated sub-extractors (posts,reels,tagged,stories,highlights,info,avatar)',
      'posts',
    )
    .option(
      '--split',
      'For stories: split each frame into a separate post',
      false,
    )
}

// ---------------------------------------------------------------------------
// Build config from parsed options
// ---------------------------------------------------------------------------

function buildConfig(opts: GlobalOptions): ConfigManager {
  const config = new ConfigManager()

  const ig: Record<string, unknown> = {}

  if (opts.videos)
    ig.videos = opts.videos
  if (opts.previews)
    ig.previews = opts.previews.split(',')
  if (opts.audio)
    ig.audio = true
  if (opts.maxPosts)
    ig['max-posts'] = opts.maxPosts
  if (opts.cursor)
    ig.cursor = opts.cursor
  if (opts.orderPosts)
    ig['order-posts'] = opts.orderPosts
  if (opts.orderFiles)
    ig['order-files'] = opts.orderFiles
  if (opts.staticVideos)
    ig['static-videos'] = true
  if (opts.api)
    ig.api = opts.api
  if (opts.include)
    ig.include = opts.include
  if (opts.split)
    ig.split = true

  if (Object.keys(ig).length > 0) {
    config.set('extractor.instagram', ig)
  }

  return config
}

// ---------------------------------------------------------------------------
// Run an extractor
// ---------------------------------------------------------------------------

async function runExtractor(
  url: string,
  extrClass: {
    new (opts: any): any
    readonly pattern: RegExp
  },
  opts: GlobalOptions,
): Promise<void> {
  const config = buildConfig(opts)
  const http = createHttpClient(opts.sessionid)
  const storage = createStorage()
  const log = createLogger(opts.verbose ?? false)

  const match = extrClass.pattern.exec(url)
  if (!match) {
    console.error(`URL did not match expected pattern: ${url}`)
    process.exit(1)
  }

  const extractor = new extrClass({
    url,
    match,
    config,
    http,
    storage,
    log,
    sessionId: opts.sessionid,
  })

  const job = new DownloadJob(
    extractor as import('../core/extractor').Extractor,
  )

  const start = Date.now()
  const status = await job.run()
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  if (status === 0) {
    log.info(`Done in ${elapsed}s`)
  }
  else {
    log.warn(`Finished with status ${status} in ${elapsed}s`)
  }
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command()

program
  .name('gdl-instagram')
  .description(
    'Download images and videos from Instagram.\n\n'
    + 'Uses gallery-dl\'s extraction pipeline — supports posts, reels,\n'
    + 'stories, highlights, tagged posts, saved collections, and more.\n\n'
    + 'Requires a sessionid cookie exported from your browser.\n'
    + 'Set via --sessionid or INSTAGRAM_SESSIONID environment variable.',
  )
  .version('0.1.0')

// ── post ──
const post = program
  .command('post <url>')
  .description(
    'Download a single Instagram post, reel, or share link\n\n'
    + 'Examples:\n'
    + '  gdl-instagram post https://www.instagram.com/p/CxAbCdEfGh/\n'
    + '  gdl-instagram post https://www.instagram.com/share/BAEvGtChfT/\n'
    + '  gdl-instagram post https://www.instagram.com/reel/CxAbCdEfGh/',
  )
  .action(async (url: string, opts: GlobalOptions) => {
    await runExtractor(url, InstagramPostExtractor, opts)
  })
addSharedOptions(post)

// ── user ──
const user = program
  .command('user <url>')
  .description(
    'Download all content from an Instagram user profile\n\n'
    + 'By default downloads posts only. Use --include to add reels,\n'
    + 'tagged, stories, highlights, info, or avatar.\n\n'
    + 'Examples:\n'
    + '  gdl-instagram user https://www.instagram.com/username/\n'
    + '  gdl-instagram user https://www.instagram.com/username/ --include=posts,reels,stories',
  )
  .action(async (url: string, opts: GlobalOptions) => {
    await runExtractor(url, InstagramUserExtractor, opts)
  })
addSharedOptions(user)

// ── stories ──
const stories = program
  .command('stories <url>')
  .description(
    'Download stories from an Instagram user\n\n'
    + 'Examples:\n'
    + '  gdl-instagram stories https://www.instagram.com/stories/username/\n'
    + '  gdl-instagram stories https://www.instagram.com/stories/highlights/12345/\n'
    + '  gdl-instagram stories --split https://www.instagram.com/stories/username/',
  )
  .action(async (url: string, opts: GlobalOptions) => {
    await runExtractor(url, InstagramStoriesExtractor, opts)
  })
addSharedOptions(stories)

// ── highlights ──
const highlights = program
  .command('highlights <url>')
  .description(
    'Download all story highlights from an Instagram user\n\n'
    + 'Examples:\n'
    + '  gdl-instagram highlights https://www.instagram.com/username/highlights/',
  )
  .action(async (url: string, opts: GlobalOptions) => {
    await runExtractor(url, InstagramHighlightsExtractor, opts)
  })
addSharedOptions(highlights)

// ── tag ──
const tag = program
  .command('tag <hashtag>')
  .description(
    'Download posts from an Instagram hashtag\n\n'
    + 'Examples:\n'
    + '  gdl-instagram tag cats\n'
    + '  gdl-instagram tag https://www.instagram.com/explore/tags/cats/',
  )
  .action(async (hashtag: string, opts: GlobalOptions) => {
    // Accept both raw tags and full URLs
    const url = hashtag.startsWith('http')
      ? hashtag
      : `https://www.instagram.com/explore/tags/${hashtag}/`
    await runExtractor(url, InstagramTagExtractor, opts)
  })
addSharedOptions(tag)

// ── saved ──
const saved = program
  .command('saved')
  .description(
    'Download your saved (bookmarked) posts\n\n'
    + 'Requires authentication via --sessionid.\n\n'
    + 'Examples:\n'
    + '  gdl-instagram saved --sessionid=abc123',
  )
  .action(async (opts: GlobalOptions) => {
    const url = 'https://www.instagram.com/me/saved/'
    await runExtractor(url, InstagramSavedExtractor, opts)
  })
addSharedOptions(saved)

// ── info ──
const info = program
  .command('info <url>')
  .description(
    'Fetch and display Instagram user profile metadata\n\n'
    + 'Examples:\n'
    + '  gdl-instagram info https://www.instagram.com/username/',
  )
  .action(async (url: string, opts: GlobalOptions) => {
    const config = buildConfig(opts)
    const http = createHttpClient(opts.sessionid)
    const storage = createStorage()
    const log = createLogger(opts.verbose ?? false)

    const match = InstagramInfoExtractor.pattern.exec(url)
    if (!match) {
      console.error(`URL did not match: ${url}`)
      process.exit(1)
    }

    const extractor = new InstagramInfoExtractor({
      url,
      match,
      config,
      http,
      storage,
      log,
      sessionId: opts.sessionid,
    })

    await extractor.initialize()
    for await (const msg of extractor) {
      if (msg.type === 'directory') {
        console.log(JSON.stringify(msg.metadata, null, 2))
      }
    }
  })

// ── avatar ──
const avatar = program
  .command('avatar <url>')
  .description(
    'Download an Instagram user\'s profile picture (HD)\n\n'
    + 'Examples:\n'
    + '  gdl-instagram avatar https://www.instagram.com/username/',
  )
  .action(async (url: string, opts: GlobalOptions) => {
    await runExtractor(url, InstagramAvatarExtractor, opts)
  })
addSharedOptions(avatar)

// ── parse ──
program.parse()
