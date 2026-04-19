/**
 * Runtime config — populated from EXPO_PUBLIC_* env vars at build time,
 * overridable at runtime through the Settings screen.
 *
 * EXPO_PUBLIC_API_BASE  → the origin of the Next.js DealNector app
 *                         that serves /api/mobile/news/feed.
 * EXPO_PUBLIC_API_KEY   → matches DEALNECTOR_MOBILE_API_KEY on the
 *                         server; leave blank if the server is open.
 */
export const DEFAULT_API_BASE =
  process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:3200'
export const DEFAULT_API_KEY = process.env.EXPO_PUBLIC_API_KEY || ''
