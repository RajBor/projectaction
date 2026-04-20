/**
 * Tolerant company-name matching for upstream-identity verification.
 *
 * Use case: NSE's `/api/quote-equity?symbol=XYZ` and Screener's HTML
 * scrape both resolve a ticker to a live row. If the ticker is
 * ambiguous (wrong-class listing, delisted symbol, shadow sub-entity)
 * the upstream can resolve to a different company. Silently writing
 * that row back into the cascade corrupts the curated baseline — this
 * was the Legrand India incident (EV ₹12,000 Cr → ₹15 Cr).
 *
 * `isLikelySameCompany(expected, observed)` returns true when the two
 * strings refer to the same entity with high confidence. A divergence
 * clamp on magnitude already rejects most poisoned rows; this is the
 * second line of defence for rows that happen to sit inside the 0.2×–5×
 * sanity band but still belong to the wrong entity.
 */

/** Common corporate suffixes / geography tokens that don't discriminate. */
const STOPWORDS = new Set([
  'limited', 'ltd', 'ltd.', 'plc', 'inc', 'incorporated', 'corporation', 'corp',
  'private', 'pvt', 'pvt.', 'company', 'co', 'co.', 'holdings', 'holding',
  'group', 'industries', 'industry', 'enterprises', 'enterprise',
  'india', 'indian', 'bharat', 'the', '&', 'and', 'of',
])

/** Strip accents, collapse whitespace, lowercase, drop punctuation. */
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining marks
    .replace(/[^a-z0-9 ]+/g, ' ')       // punctuation → space
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tokenize a normalized name into significant tokens (drop stopwords). */
function significantTokens(raw: string): string[] {
  return normalize(raw)
    .split(' ')
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
}

/**
 * Verdict: do these two names plausibly refer to the same company?
 *
 * Heuristic:
 *   - Both sides tokenised, stopwords dropped.
 *   - If either side collapses to zero significant tokens, fall back
 *     to the raw normalized strings having any overlap.
 *   - Otherwise, require that at least half of the expected side's
 *     significant tokens appear in the observed side (substring match
 *     so "Bijlee" also matches "Bijli"). Tokens ≤ 2 chars are skipped
 *     in the overlap check to avoid false positives on short acronyms.
 *
 * This is deliberately forgiving — NSE occasionally appends "Ltd." or
 * includes SPV tags, and Screener sometimes reorders to "Industries
 * Ltd" vs "Industries, The". We reject only when the core brand tokens
 * don't line up at all.
 */
export function isLikelySameCompany(expected: string, observed: string): boolean {
  if (!expected || !observed) return true  // can't verify — don't block
  const expNorm = normalize(expected)
  const obsNorm = normalize(observed)
  if (!expNorm || !obsNorm) return true
  if (expNorm === obsNorm) return true
  if (expNorm.includes(obsNorm) || obsNorm.includes(expNorm)) return true

  const expTokens = significantTokens(expected).filter((t) => t.length > 2)
  const obsTokens = significantTokens(observed).filter((t) => t.length > 2)

  // If tokenization stripped everything (e.g., "Co Ltd" only), fall back
  // to the normalized-substring test that already happened above — it
  // failed, so this is a mismatch. Default to accept when expected is
  // truly empty after stripping (nothing to compare against).
  if (expTokens.length === 0) return true
  if (obsTokens.length === 0) return false

  let hits = 0
  for (const t of expTokens) {
    if (obsTokens.some((o) => o.includes(t) || t.includes(o))) hits += 1
  }
  // Require at least half of expected's brand tokens to line up.
  return hits / expTokens.length >= 0.5
}

/** Extract a company name from a Screener.in HTML page.
 *
 * Screener renders the company masthead as <h1 class="margin-0">Name</h1>.
 * Falls back to the <title> tag's leading fragment if the H1 isn't
 * found. Returns null if neither is present.
 */
export function parseScreenerCompanyName(html: string): string | null {
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
  if (h1 && h1[1]) {
    const name = h1[1].trim()
    if (name.length > 0) return name
  }
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (title && title[1]) {
    // Screener titles are usually "Company Name — Screener" or similar
    const name = title[1].split(/[-|—–]/)[0].trim()
    if (name.length > 0) return name
  }
  return null
}
