/**
 * Indian number formatting — shared across the entire platform.
 *
 * Convention:
 *   L   = Lakh   = 10^5  (₹1,00,000)
 *   Cr  = Crore  = 10^7  (₹1,00,00,000)
 *
 * All financial values in DealNector's Company model are in ₹Cr.
 * This helper formats them with the Indian comma grouping system
 * (lakh-crore style: 1,23,456 not 123,456) and appends " Cr".
 *
 * IMPORTANT: "L Cr" means "Lakh Crore" = 10^12.
 * "K Cr" means "Thousand Crore" = 10^10.
 * Neither of these should appear for values that are just plain ₹Cr.
 *
 * Examples (input is already in ₹Cr):
 *   98174    →  ₹98,174 Cr
 *   119135   →  ₹1,19,135 Cr
 *   656860   →  ₹6,56,860 Cr
 *   52000    →  ₹52,000 Cr
 *   3400     →  ₹3,400 Cr
 *   686      →  ₹686 Cr
 *   0        →  ₹0 Cr
 */

const indianFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
})

/**
 * Format a value that is already denominated in ₹Cr.
 * Returns a string like "₹98,174 Cr" with Indian comma grouping.
 */
export function formatInrCr(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value < 0) return `−₹${indianFormatter.format(Math.abs(Math.round(value)))} Cr`
  return `₹${indianFormatter.format(Math.round(value))} Cr`
}

/**
 * Compact variant for tight table cells. Uses the same Indian
 * comma grouping but omits the "₹" prefix when space is limited.
 * The caller is responsible for prefixing ₹ if desired.
 */
export function formatCrCompact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${indianFormatter.format(Math.round(Math.abs(value)))} Cr`
}

/**
 * Format a percentage with sign and fixed decimals.
 */
export function formatPctSigned(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

/**
 * Format a ratio (×) with fixed decimals.
 */
export function formatRatioX(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}×`
}
