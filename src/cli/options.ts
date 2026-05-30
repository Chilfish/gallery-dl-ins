/** Shared CLI options, config building, and option decoration. */

import type { Command } from 'commander'
import { ConfigManager } from '../config'

export interface GlobalOptions {
  sessionid?: string
  cookies?: string
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
  info?: boolean
}

export function addSharedOptions(cmd: Command): Command {
  return cmd
    .option('--sessionid <cookie>', 'Instagram sessionid cookie value (from browser)', process.env.INSTAGRAM_SESSIONID)
    .option('--cookies <string>', 'Full Cookie header string from browser', process.env.INSTAGRAM_COOKIES)
    .option('-o, --output <dir>', 'Output directory', './data')
    .option('--videos <mode>', 'Download videos: true, false, or merged (yt-dlp)', 'true')
    .option('--previews <types>', 'Download only previews: video,audio (comma-separated)')
    .option('--audio', 'Download standalone audio tracks', false)
    .option('--max-posts <n>', 'Maximum number of posts to download', Number.parseInt)
    .option('--cursor <cursor>', 'Resume from pagination cursor')
    .option('--order-posts <order>', 'Post ordering: asc, desc, id, id_asc, id_desc')
    .option('--order-files <order>', 'File ordering: r, d (reverse), or empty for natural order')
    .option('--static-videos', 'Download static video cover images instead of actual videos', false)
    .option('--no-static-videos', 'Do not force static video covers')
    .option('--api <backend>', 'API backend: rest (default) or graphql', 'rest')
    .option('-v, --verbose', 'Verbose debug output', false)
    .option('--include <list>', 'For user: comma-separated sub-extractors (posts,reels,tagged,stories,highlights,info,avatar)', 'posts')
    .option('--split', 'For stories: split each frame into a separate post', false)
    .option('-i, --info', 'Print structured post info to terminal (no download)', false)
}

export function buildConfig(opts: GlobalOptions): ConfigManager {
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

  if (Object.keys(ig).length > 0)
    config.set('extractor.instagram', ig)
  return config
}
