/** Extract-and-run logic shared across CLI commands. */

import type { GlobalOptions } from './options'
import { DownloadJob } from '../core/download-job'
import { PrintJob } from '../core/print-job'
import {
  InstagramHighlightsExtractor,
  InstagramPostExtractor,
  InstagramSavedExtractor,
  InstagramStoriesExtractor,
  InstagramTagExtractor,
  InstagramUserExtractor,
} from '../instagram/extractors'
import { createHttpClient, createLogger, createWebClient, extractCsrfFromCookies } from './adapter'
import { buildConfig } from './options'
import { createStorage } from './storage'

interface ExtrLike {
  new (opts: any): any
  readonly pattern: RegExp
}

export function resolveExtractor(url: string): ExtrLike {
  for (const Cls of [
    InstagramPostExtractor,
    InstagramStoriesExtractor,
    InstagramHighlightsExtractor,
    InstagramTagExtractor,
    InstagramSavedExtractor,
    InstagramUserExtractor,
  ]) {
    if (Cls.pattern.test(url))
      return Cls
  }

  throw new Error(
    `No extractor matched URL: ${url}. `
    + 'Supported: /p/, /reel/, /{user}/, /stories/, /highlights/, /explore/tags/, /saved/',
  )
}

export async function runExtractor(
  url: string,
  extrClass: ExtrLike,
  opts: GlobalOptions,
): Promise<void> {
  const config = buildConfig(opts)
  const log = createLogger(opts.verbose ?? false)
  let http: ReturnType<typeof createHttpClient>
  let webCsrf: string | undefined

  if (opts.cookies) {
    http = createHttpClient(undefined, opts.cookies, log)
    webCsrf = extractCsrfFromCookies(opts.cookies)
  }
  else if (opts.sessionid) {
    http = createHttpClient(opts.sessionid, undefined, log)
  }
  else {
    const wc = await createWebClient(log)
    http = wc.http
    webCsrf = wc.csrfToken
  }
  const storage = createStorage()

  const match = extrClass.pattern.exec(url)
  if (!match) {
    console.error(`URL did not match expected pattern: ${url}`)
    process.exit(1)
  }

  // eslint-disable-next-line new-cap
  const extractor = new extrClass({
    url,
    match,
    config,
    http,
    storage,
    log,
    sessionId: opts.sessionid,
    csrfToken: webCsrf,
  })

  if (opts.info) {
    const job = new PrintJob(extractor as import('../core/extractor').Extractor)
    const start = Date.now()
    try {
      const status = await job.run()
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      if (status !== 0)
        log.warn(`Finished with status ${status} in ${elapsed}s`)
    }
    catch (err) {
      log.error(String(err))
      process.exit(1)
    }
    return
  }

  const job = new DownloadJob(extractor as import('../core/extractor').Extractor)
  job.basePath = opts.output ?? './data'

  const start = Date.now()
  try {
    const status = await job.run()
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    if (status === 0)
      log.info(`Done in ${elapsed}s`)
    else log.warn(`Finished with status ${status} in ${elapsed}s`)
  }
  catch (err) {
    log.error(String(err))
    process.exit(1)
  }
}
