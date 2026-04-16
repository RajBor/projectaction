/**
 * Gemini 2.5 Flash client for peer-verification (server-side only).
 *
 * Why REST over the official SDK:
 * The Gemini 2.5 family uses the `google_search` tool (Google Search
 * grounding, free up to 500 requests/day on the AI Studio free tier).
 * The older `@google/generative-ai` npm package we have installed
 * exposes only the 1.5-era `googleSearchRetrieval` shape, so we'd be
 * fighting the types to call 2.5 through the SDK. The REST surface
 * is stable and type-safe once we declare the payload shape ourselves.
 *
 * Rate / quota guardrails are enforced by the caller (see
 * `/api/peers/verify/route.ts`) — this file is pure transport.
 *
 * Key lives in GEMINI_API_KEY. NEVER re-export it or log it.
 */

const GEMINI_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'gemini-2.5-flash'

// ── Types --------------------------------------------------------

export interface PeerCandidate {
  name: string
  ticker: string | null
  isPrivate: boolean
  productLine: string
  /** Parallel list of source URLs that ground the claim. */
  evidence: Array<{ url: string; title?: string; quote?: string }>
}

export interface VerifyPeersResult {
  candidates: PeerCandidate[]
  /** Raw grounding metadata returned by Gemini — kept for audit. */
  groundingSources: Array<{ uri: string; title?: string }>
  model: string
  latencyMs: number
}

// ── The response schema we force Gemini into -------------------

const PEER_CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      description:
        'Up to 8 Indian companies (listed or private) that manufacture/service the given sub-segment.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Company name as it trades/operates.' },
          ticker: {
            type: 'string',
            description:
              'NSE ticker if listed, else empty string. Do NOT include the .NS suffix.',
          },
          isPrivate: { type: 'boolean' },
          productLine: {
            type: 'string',
            description:
              '1-sentence description of their specific offering in this sub-segment.',
          },
          evidenceUrls: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Specific URLs (company site, news article, annual report) supporting the claim.',
          },
        },
        required: ['name', 'ticker', 'isPrivate', 'productLine', 'evidenceUrls'],
      },
    },
  },
  required: ['candidates'],
} as const

// ── Public API ---------------------------------------------------

/**
 * Ask Gemini (with Google Search grounding) to name Indian companies
 * in a given sub-segment and return them as structured JSON.
 *
 * Free tier: 500 req/day, 10 RPM. Caller should short-circuit on cache
 * hits before reaching this function.
 *
 * Throws on any failure — the caller is expected to handle fallback
 * (DB-only response) and write to `gemini_api_log`.
 */
export async function verifyPeersForSubSegment(opts: {
  subSegmentId: string
  subSegmentName: string
  subSegmentParentStage?: string
  industryName?: string
  /** Optional subject ticker to contextualise peers (e.g. "include companies similar to Waaree Energies"). */
  subjectName?: string
  signal?: AbortSignal
}): Promise<VerifyPeersResult> {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    throw new Error('GEMINI_API_KEY is not set on the server')
  }

  const prompt = buildPrompt(opts)
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.1,
      topP: 0.9,
      maxOutputTokens: 2048,
      // Structured output — Gemini will emit valid JSON matching the
      // schema. When grounding (google_search) is enabled we keep the
      // schema hint in the prompt too, because Gemini occasionally
      // ignores responseSchema when a tool is active.
      responseMimeType: 'application/json',
      responseSchema: PEER_CANDIDATE_SCHEMA,
    },
    // Block low-safety prompts from blowing up our audit noise.
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  }

  const url = `${GEMINI_BASE}/${DEFAULT_MODEL}:generateContent?key=${encodeURIComponent(key)}`
  const started = Date.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  const latencyMs = Date.now() - started

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Gemini ${res.status}: ${text.slice(0, 500) || res.statusText}`
    )
  }

  const json: GeminiResponse = await res.json()
  const firstCandidate = json.candidates?.[0]
  const parts = firstCandidate?.content?.parts || []
  const textPart = parts.find((p) => typeof p.text === 'string')
  if (!textPart || !textPart.text) {
    throw new Error('Gemini returned no text content')
  }

  const parsed = safeParseJson(textPart.text)
  if (!parsed || !Array.isArray(parsed.candidates)) {
    throw new Error('Gemini returned unparseable JSON (no candidates array)')
  }

  const groundingSources = extractGroundingSources(firstCandidate)
  const candidates: PeerCandidate[] = parsed.candidates
    .filter((c: unknown): c is RawCandidate => isRawCandidate(c))
    .map((c) => ({
      name: String(c.name || '').trim(),
      ticker: c.ticker ? String(c.ticker).trim().toUpperCase() : null,
      isPrivate: Boolean(c.isPrivate),
      productLine: String(c.productLine || '').trim(),
      evidence: Array.isArray(c.evidenceUrls)
        ? c.evidenceUrls
            .filter((u: unknown): u is string => typeof u === 'string' && u.startsWith('http'))
            .map((u: string) => {
              const match = groundingSources.find((g) => g.uri === u)
              return { url: u, title: match?.title }
            })
        : [],
    }))
    .filter((c) => c.name.length > 0)

  return { candidates, groundingSources, model: DEFAULT_MODEL, latencyMs }
}

// ── Prompt construction ------------------------------------------

function buildPrompt(opts: {
  subSegmentId: string
  subSegmentName: string
  subSegmentParentStage?: string
  industryName?: string
  subjectName?: string
}): string {
  const context: string[] = []
  if (opts.industryName) context.push(`Industry: ${opts.industryName}`)
  if (opts.subSegmentParentStage) context.push(`Value-chain stage: ${opts.subSegmentParentStage}`)
  context.push(`Sub-segment: ${opts.subSegmentName} (id ${opts.subSegmentId})`)
  if (opts.subjectName) context.push(`Subject company (for peer context): ${opts.subjectName}`)

  return [
    `You are a precise equity research analyst covering Indian markets.`,
    `Using Google Search, identify up to 8 Indian companies that specifically operate in the sub-segment below.`,
    '',
    context.join('\n'),
    '',
    `Return JSON matching the schema. Rules:`,
    `- Only include companies with verifiable presence in this SPECIFIC sub-segment — not just the broader industry.`,
    `- Include both NSE-listed AND private companies. For private set ticker="" and isPrivate=true.`,
    `- The 'productLine' field must state their actual offering (e.g. capacity GW, product line name).`,
    `- 'evidenceUrls' must contain specific URLs (company product pages, annual-report extracts, credible news). Do NOT invent URLs.`,
    `- If you cannot confidently verify 5 companies, return fewer rather than guess.`,
    `Respond with ONLY the JSON. No commentary.`,
  ].join('\n')
}

// ── Parsing helpers ---------------------------------------------

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>
      webSearchQueries?: string[]
    }
  }>
}

interface RawCandidate {
  name: string
  ticker?: string
  isPrivate?: boolean
  productLine?: string
  evidenceUrls?: string[]
}

function isRawCandidate(x: unknown): x is RawCandidate {
  return typeof x === 'object' && x !== null && typeof (x as { name?: unknown }).name === 'string'
}

function safeParseJson(raw: string): { candidates?: unknown[] } | null {
  // Gemini occasionally wraps JSON in ```json fences despite responseMimeType.
  const trimmed = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function extractGroundingSources(
  cand: NonNullable<GeminiResponse['candidates']>[number] | undefined
): Array<{ uri: string; title?: string }> {
  const chunks = cand?.groundingMetadata?.groundingChunks || []
  return chunks
    .map((c) => c.web)
    .filter((w): w is { uri: string; title?: string } => !!w && typeof w.uri === 'string')
    .map((w) => ({ uri: w.uri, title: w.title }))
}

// ── Quota helpers (exported for the API route to count) ---------

export const GEMINI_FREE_DAILY_CAP = 500

export function getGeminiModelId(): string {
  return DEFAULT_MODEL
}
