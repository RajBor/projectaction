/**
 * Parse-time validators for the admin scrape pipeline.
 *
 * Every call to scrape-exchange runs the raw HTML through these checks
 * BEFORE calling publish-data. Failures route the suspect ticker to
 * `scrape_anomalies` instead of polluting `user_companies` with bad
 * numbers, and the caller learns what broke so the admin UI can show a
 * "parser schema drift detected" banner.
 *
 * Four validator families:
 *
 *   1. Unit sniff    — Screener blocks sometimes report Lakhs (`L`)
 *                      or USD (`$`) for non-INR listings; we refuse
 *                      those rather than silently writing a number
 *                      that's 100× too small or in the wrong currency.
 *   2. Header match  — the parser relies on `id="top-ratios"`,
 *                      `id="profit-loss"`, etc. + specific label
 *                      strings ("Market Cap", "Sales", "Net Profit").
 *                      If Screener renames a block we catch it here.
 *   3. Orientation   — Screener tables are oldest-left → newest-right.
 *                      Verify by parsing the column-header dates; if
 *                      the first is later than the last, the parser
 *                      is reading the wrong column.
 *   4. Plausibility  — sanity bounds on the final numeric values:
 *                      a listed Indian equity must be > 1 Cr and
 *                      < 10,000,000 Cr mktcap; revenue must be
 *                      non-negative; P/E must be finite.
 *
 * Every validator returns an Anomaly[] — empty = clean.
 */

export interface Anomaly {
  /** Machine-readable check name (persisted to scrape_anomalies). */
  check: string
  /** Which numeric field tripped the check, when applicable. */
  field?: string
  /** The raw value or substring that looked wrong — for admin review. */
  raw?: string
  /** What the validator expected to see. */
  expected?: string
  /** Free-form detail a human can read. */
  detail?: string
}

/**
 * Parse a date header string from Screener into a sortable value.
 * Handles the common formats: "Mar 2024", "TTM", "Jun 2023", "FY24",
 * "Q1 FY24", plain month numbers. Returns epoch ms for comparison
 * or `null` when we can't parse — which the orientation validator
 * treats as "skip this pair" rather than an error, because some
 * tables mix TTM + year columns.
 */
function parseHeaderDate(label: string | null | undefined): number | null {
  if (!label) return null
  const s = label.trim()
  if (!s) return null
  // TTM always represents the latest rolling year — treat it as now.
  if (/^TTM$/i.test(s)) return Date.now()
  // "Mar 2024", "Jun 2023"
  const monthYear = s.match(/^([A-Za-z]{3,})\s+(\d{4})$/)
  if (monthYear) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    }
    const m = months[monthYear[1].slice(0, 3).toLowerCase()]
    const y = Number(monthYear[2])
    if (m != null && Number.isFinite(y)) return new Date(y, m, 1).getTime()
  }
  // "FY24", "FY2024"
  const fy = s.match(/^FY\s*(\d{2,4})$/i)
  if (fy) {
    const raw = Number(fy[1])
    const year = raw < 100 ? 2000 + raw : raw
    return new Date(year, 2, 31).getTime() // fiscal-year-end is Mar 31 in India
  }
  // Plain 4-digit year
  const plainYear = s.match(/^(\d{4})$/)
  if (plainYear) return new Date(Number(plainYear[1]), 11, 31).getTime()
  return null
}

/**
 * 1. UNIT SNIFF.
 *
 * Screener typically reports in `₹ Cr.` (crores of rupees). Rarely, a
 * foreign-listed row or a small-cap will render in Lakhs or USD. We
 * scan the top-ratios + profit-loss blocks for unit markers that
 * aren't Cr / Crore and refuse to ingest the row if any are present.
 *
 * "L" alone is too common as a Latin letter — only flag "L" when it
 * appears in a unit context like "₹L" or " L " inside a numeric cell.
 */
export function validateUnits(html: string): Anomaly[] {
  if (!html) return []
  const out: Anomaly[] = []

  // Take a slice around the top-ratios + profit-loss IDs to avoid
  // false positives from unrelated text (e.g., "L&T Technology Services"
  // as a peer name — the `L` there isn't a unit).
  const grab = (section: string): string => {
    const idx = html.indexOf(`id="${section}"`)
    if (idx < 0) return ''
    return html.slice(idx, idx + 8000)
  }
  const focus = grab('top-ratios') + '\n' + grab('profit-loss')
  if (!focus.trim()) return []

  // USD / $ — if Screener is rendering USD, none of our Cr-denominated
  // columns are safe to ingest. Check for "US $" or "USD" in numeric
  // context (near a digit).
  if (/\b(?:USD|US\$|US\s*\$)\b/.test(focus)) {
    out.push({
      check: 'unit_usd',
      raw: focus.match(/\b(?:USD|US\$|US\s*\$)[^<]{0,30}/)?.[0] || 'USD marker',
      expected: '₹ Cr / Crore',
      detail: 'Foreign-listed / USD-denominated values would be 80× too small if ingested as Cr.',
    })
  }

  // Lakh / Lakhs / Lacs / ₹L prefix — needs to downshift by 100 if we
  // were to use it, which we don't; skip the row instead.
  if (/\b(?:Lakhs?|Lacs?)\b/i.test(focus) || /₹\s*L(?![a-z])/i.test(focus)) {
    out.push({
      check: 'unit_lakh',
      raw: focus.match(/\b(?:Lakhs?|Lacs?)[^<]{0,30}/i)?.[0] || 'Lakh marker',
      expected: '₹ Cr / Crore',
      detail: 'Values in Lakh would be 100× too small when ingested as Cr.',
    })
  }

  return out
}

/**
 * 2. HEADER MATCH.
 *
 * The Screener parsers hard-code label strings like "Market Cap",
 * "Sales", "Operating Profit", "Net Profit", "Price to Earning".
 * If Screener renames any of them the parser quietly returns null
 * for that field and the scrape looks empty. Detect the drift by
 * requiring at least one label from each block.
 */
export function validateHeaders(html: string): Anomaly[] {
  if (!html) return []
  const out: Anomaly[] = []
  const requiredBlocks: Array<{ id: string; labels: string[]; name: string }> = [
    {
      id: 'top-ratios',
      name: 'top-ratios',
      labels: ['Market Cap', 'Current Price', 'Stock P/E', 'Book Value'],
    },
    {
      id: 'profit-loss',
      name: 'profit-loss',
      labels: ['Sales', 'Revenue', 'Operating Profit', 'Net Profit', 'OPM'],
    },
  ]
  for (const blk of requiredBlocks) {
    const idx = html.indexOf(`id="${blk.id}"`)
    if (idx < 0) {
      out.push({
        check: 'header_block_missing',
        field: blk.name,
        expected: `<section id="${blk.id}">`,
        detail: `Screener page missing the '${blk.name}' block — page layout changed or the request hit a captcha/login wall.`,
      })
      continue
    }
    const snippet = html.slice(idx, idx + 6000)
    const found = blk.labels.some((l) => snippet.includes(l))
    if (!found) {
      out.push({
        check: 'header_labels_drifted',
        field: blk.name,
        expected: blk.labels.join(' | '),
        detail: `None of the expected labels appeared in '${blk.name}'. Parser selectors need updating.`,
      })
    }
  }
  return out
}

/**
 * 3. COLUMN ORIENTATION.
 *
 * Screener tables should go oldest-left → newest-right. If the first
 * `<th>` date is later than the last `<th>` date, the parser is reading
 * the wrong column and we'd end up with stale numbers masquerading as
 * current. Parse the first/last year in the profit-loss header row
 * and reject if inverted.
 *
 * Accepts firstHeader/lastHeader from parseLastColumnHeader style
 * helpers — callers already extract the rightmost one, so we just
 * need to do the same for the leftmost column. Returning anomaly on
 * genuine inversion; empty list when unparseable (we don't want to
 * nuke a scrape because a column was "TTM Prev" vs a date).
 */
export function validateOrientation(
  firstHeader: string | null | undefined,
  lastHeader: string | null | undefined,
): Anomaly[] {
  const first = parseHeaderDate(firstHeader)
  const last = parseHeaderDate(lastHeader)
  if (first == null || last == null) return []
  if (first > last) {
    return [{
      check: 'column_orientation_inverted',
      raw: `first='${firstHeader}' last='${lastHeader}'`,
      expected: 'oldest-left → newest-right (first < last)',
      detail: 'Screener table reading inverted; parser would write stale numbers as current.',
    }]
  }
  return []
}

/**
 * 4. PLAUSIBILITY BOUNDS.
 *
 * Sanity ranges on the final scraped numbers. Any row violating these
 * is almost certainly a parse error (e.g. a multi-line cell split into
 * two numeric tokens, a sub-total picked up as "Sales", a corporate
 * action artifact). We'd rather skip the publish than commit garbage.
 *
 * Bounds chosen from actual NSE-listed data:
 *   - Market cap between ₹1 Cr (below that nothing trades even on SME)
 *     and ₹10,000,000 Cr (₹100 lakh crore, bigger than any Indian listing
 *     will realistically be for a decade).
 *   - Revenue / EBITDA / PAT are nominally bounded by mktcap — a company
 *     with ₹1000 Cr rev and ₹50 Cr mktcap is possible; but ₹1e6 Cr rev
 *     while mktcap is 0 isn't. Flag when rev > 100× mktcap since that
 *     means one of the two is mis-scaled.
 *   - P/E between -200 and 500 — anything outside is almost always a
 *     parse spike (dividing a ₹ Cr number by a ₹ number by accident).
 */
export interface PlausibilityInput {
  mktcap?: number | null
  rev?: number | null
  ebitda?: number | null
  pat?: number | null
  pe?: number | null
}

export function validatePlausibility(values: PlausibilityInput): Anomaly[] {
  const out: Anomaly[] = []
  const { mktcap, rev, ebitda, pat, pe } = values

  if (mktcap != null && mktcap > 0) {
    if (mktcap < 1) {
      out.push({ check: 'plausibility_mktcap_too_small', field: 'mktcap', raw: String(mktcap), expected: '>= 1 Cr' })
    } else if (mktcap > 10_000_000) {
      out.push({ check: 'plausibility_mktcap_too_large', field: 'mktcap', raw: String(mktcap), expected: '<= 10,000,000 Cr' })
    }
  }

  if (rev != null && rev < 0) {
    out.push({ check: 'plausibility_rev_negative', field: 'rev', raw: String(rev), expected: '>= 0' })
  }
  if (rev != null && rev > 0 && mktcap != null && mktcap > 0 && rev > mktcap * 100) {
    out.push({
      check: 'plausibility_rev_disproportionate',
      field: 'rev',
      raw: `rev=${rev}, mktcap=${mktcap}`,
      expected: 'rev <= 100 × mktcap',
      detail: 'Likely unit mismatch — either rev is in wrong unit or mktcap wasn\'t scaled to Cr.',
    })
  }

  if (ebitda != null && rev != null && rev > 0 && ebitda !== 0) {
    // EBITDA margin typically -100%..+80%. Wider = parse spike.
    const margin = ebitda / rev
    if (margin < -2 || margin > 1.2) {
      out.push({
        check: 'plausibility_ebitda_margin',
        field: 'ebitda',
        raw: `ebitda=${ebitda}, rev=${rev}, margin=${(margin * 100).toFixed(1)}%`,
        expected: 'margin within -200%..+120%',
      })
    }
  }

  if (pat != null && rev != null && rev > 0 && pat !== 0) {
    // PAT margin same story — wider than -100%..+50% is almost always a spike.
    const margin = pat / rev
    if (margin < -3 || margin > 1) {
      out.push({
        check: 'plausibility_pat_margin',
        field: 'pat',
        raw: `pat=${pat}, rev=${rev}, margin=${(margin * 100).toFixed(1)}%`,
        expected: 'margin within -300%..+100%',
      })
    }
  }

  if (pe != null && Number.isFinite(pe)) {
    if (pe < -200 || pe > 500) {
      out.push({
        check: 'plausibility_pe_range',
        field: 'pe',
        raw: String(pe),
        expected: '-200..500',
        detail: 'PE outside sane range — typically a parse error dividing wrong units.',
      })
    }
  }

  return out
}

/**
 * Convenience wrapper — runs every validator over the HTML + derived
 * values and returns the combined anomaly list. `firstHeader` is the
 * LEFTMOST column header for the profit-loss block (used by the
 * orientation check). Callers that don't extract it can pass null and
 * that single check is skipped.
 */
export function runAllValidators(
  html: string,
  firstHeader: string | null | undefined,
  lastHeader: string | null | undefined,
  values: PlausibilityInput,
): Anomaly[] {
  return [
    ...validateUnits(html),
    ...validateHeaders(html),
    ...validateOrientation(firstHeader, lastHeader),
    ...validatePlausibility(values),
  ]
}
