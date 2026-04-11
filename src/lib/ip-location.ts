/**
 * Best-effort IP + geolocation extraction for signup/login tracking.
 *
 * Looks at the usual forwarded-for headers, then enriches via the
 * free ip-api.com HTTP endpoint (no key, rate-limited). Every failure
 * path silently returns null so the caller never blocks on this.
 */

export interface GeoInfo {
  ip: string | null
  location: string | null
}

/** Read the client IP from a server-side Next.js Request. */
export function getClientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf.trim()
  return null
}

/**
 * Call the free ip-api.com endpoint to get {city, country}. Returns a
 * compact "City, Country" string or null on any error.
 */
export async function lookupLocation(ip: string | null): Promise<string | null> {
  if (!ip) return null
  // Skip localhost / private ranges
  if (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.')
  ) {
    return 'Local'
  }
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 3500)
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city`,
      { signal: controller.signal }
    )
    clearTimeout(t)
    if (!res.ok) return null
    const data = (await res.json()) as {
      status?: string
      country?: string
      regionName?: string
      city?: string
    }
    if (data.status !== 'success') return null
    const parts: string[] = []
    if (data.city) parts.push(data.city)
    else if (data.regionName) parts.push(data.regionName)
    if (data.country) parts.push(data.country)
    return parts.length ? parts.join(', ') : null
  } catch {
    return null
  }
}

/** Convenience — extract IP from req and enrich with location. */
export async function geoFromRequest(req: Request): Promise<GeoInfo> {
  const ip = getClientIp(req)
  const location = await lookupLocation(ip)
  return { ip, location }
}
