#!/usr/bin/env node
/**
 * gdl-instagram — CLI entry point.
 *
 * Usage:
 *   gdl-instagram <url> [options]          ← auto-detect from URL
 *   gdl-instagram tag <hashtag> [options]
 *   gdl-instagram saved [options]
 */

import type { GlobalOptions } from './options'
import { Command } from 'commander'
import packageJSON from '../../package.json'
import { InstagramSavedExtractor, InstagramTagExtractor } from '../instagram/extractors'
import { addSharedOptions } from './options'
import { resolveExtractor, runExtractor } from './runner'

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
  .version(packageJSON.version)

/** Default command — auto-detect extractor from URL */
const dlCmd = program
  .command('dl', { isDefault: true })
  .argument('[url]', 'Instagram URL to download (auto-detects type)')
  .description(
    'Download media from an Instagram URL (auto-detects post/user/stories/…)\n\n'
    + 'Examples:\n'
    + '  gdl-instagram https://www.instagram.com/p/CxAbCdEfGh/\n'
    + '  gdl-instagram https://www.instagram.com/username/ --include=posts,reels\n'
    + '  gdl-instagram https://www.instagram.com/stories/username/',
  )
  .action(async (url: string | undefined, opts: GlobalOptions) => {
    if (!url) {
      program.help()
      return
    }
    await runExtractor(url, resolveExtractor(url), opts)
  })
addSharedOptions(dlCmd)

/** tag subcommand */
const tagCmd = program
  .command('tag <hashtag>')
  .description(
    'Download posts from an Instagram hashtag\n\n'
    + 'Examples:\n'
    + '  gdl-instagram tag cats\n'
    + '  gdl-instagram tag https://www.instagram.com/explore/tags/cats/',
  )
  .action(async (hashtag: string, opts: GlobalOptions) => {
    const url = hashtag.startsWith('http')
      ? hashtag
      : `https://www.instagram.com/explore/tags/${hashtag}/`
    await runExtractor(url, InstagramTagExtractor, opts)
  })
addSharedOptions(tagCmd)

/** saved subcommand */
const savedCmd = program
  .command('saved')
  .description(
    'Download your saved (bookmarked) posts\n\n'
    + 'Requires authentication via --sessionid.\n\n'
    + 'Examples:\n'
    + '  gdl-instagram saved --sessionid=abc123',
  )
  .action(async (opts: GlobalOptions) => {
    await runExtractor('https://www.instagram.com/me/saved/', InstagramSavedExtractor, opts)
  })
addSharedOptions(savedCmd)

program.parse()
