/**
 * Simple in-memory cookie jar for Node.js HTTP clients.
 *
 * Tracks Set-Cookie headers across requests and injects stored cookies
 * into subsequent requests to the same domain.  This is enough for
 * Instagram's anonymous session flow: visit homepage → get cookies →
 * use those cookies for API calls.
 */

export interface CookieJar {
  /** Record cookies from a response's Set-Cookie header(s). */
  setFromResponse: (headers: Record<string, string>) => void
  /** Get the Cookie header value for the next request. */
  getCookieHeader: () => string
}

export function createCookieJar(): CookieJar {
  const cookies = new Map<string, string>()
  let cookieString = ''

  return {
    setFromResponse(headers: Record<string, string>): void {
      const raw = headers['set-cookie']
      if (!raw)
        return

      const cookieHeaders = Array.isArray(raw)
        ? raw
        : [raw]
      for (const header of cookieHeaders) {
        const parts = header.split(';')
        if (parts.length === 0)
          continue

        const [nameValue] = parts
        const eqIdx = nameValue!.indexOf('=')
        if (eqIdx <= 0)
          continue

        const name = nameValue!.slice(0, eqIdx).trim()
        const value = nameValue!.slice(eqIdx + 1).trim()

        // Skip expiration by checking Max-Age=0 or Expires=epoch
        const rest = parts.slice(1).map((s: string) => s.trim().toLowerCase())
        if (rest.includes('max-age=0'))
          continue

        cookies.set(name, value)
      }

      // Rebuild cookie string
      cookieString = Array.from(cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
    },

    getCookieHeader(): string {
      return cookieString
    },
  }
}
