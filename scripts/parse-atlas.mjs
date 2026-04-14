#!/usr/bin/env node
/**
 * Parse pdf_extract.txt (produced by pdf-parse on the Waaree Atlas PDF) into
 * a structured JSON file ready for seeding into the industries / chain nodes /
 * chain companies tables.
 *
 * Usage:  node scripts/parse-atlas.mjs
 * Output: src/data/atlas-seed.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '..', 'pdf_extract.txt')
const OUT = path.join(__dirname, '..', 'src', 'data', 'atlas-seed.json')

const STATUS_TOKENS = ['MAIN', 'SME', 'SUBSIDIARY', 'PRIVATE', 'GOVT/PSU']
const STATUS_RE = new RegExp(`\\b(${STATUS_TOKENS.join('|').replace('/', '\\/')})\\b`)

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

function stripNoise(line) {
  // Remove the running page header/footer, trailing page-counter lines etc.
  const l = line.trimEnd()
  if (!l.trim()) return ''
  if (/^Industry Value Chain Atlas \|.*Page \d+/.test(l)) return ''
  if (/^-- \d+ of \d+ --$/.test(l.trim())) return ''
  return l
}

function loadRawLines() {
  const raw = fs.readFileSync(SRC, 'utf8')
  return raw.split(/\r?\n/)
}

/**
 * Split the raw lines into one block per industry, keyed by the "INDUSTRY NN"
 * marker at the start of the page. Returns array of { code, startLine, endLine, lines[] }.
 */
function splitByIndustry(lines) {
  const anchors = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^INDUSTRY (\d{2})$/)
    if (m) anchors.push({ code: `I${m[1]}`, line: i })
  }
  const blocks = []
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].line
    const end = i + 1 < anchors.length ? anchors[i + 1].line : lines.length
    blocks.push({
      code: anchors[i].code,
      startLine: start,
      endLine: end,
      lines: lines.slice(start, end),
    })
  }
  return blocks
}

/**
 * Extract {label, description, stages[]} from an industry block.
 * Stage detection: a "Status Exchange Ticker / Code Value Chain Role" header.
 * Anything preceding the first stage header is the industry intro:
 *   line 0: "INDUSTRY NN"
 *   line 1: industry label
 *   lines 2..k: multi-line description paragraph
 *   line k+1 (optional): abbreviated stages list separated by ".."
 * A stage name may occupy 1–2 lines just before the "Status Exchange …" marker.
 */
function parseIndustry(block) {
  const lines = block.lines
    .map(stripNoise)
    .filter((l, i, arr) => !(l === '' && (arr[i - 1] === '' || i === 0)))

  const label = lines[1] || block.code
  // Find first Status Exchange header
  let headerStart = -1
  for (let i = 2; i < lines.length; i++) {
    if (/Status\s+Exchange\s+Ticker\s*\/\s*Code\s+Value\s+Chain\s+Role/i.test(lines[i])) {
      headerStart = i
      break
    }
  }

  // Intro description: everything between label and the abbreviated stage list.
  // The abbreviated list contains ".. " tokens, so detect and drop that line.
  let introEnd = headerStart === -1 ? lines.length : headerStart
  // Detect & trim the abbreviated stage preview line (e.g. "Raw Materials, .. Wafer, Cell & M..")
  let abbrevIdx = -1
  for (let i = 2; i < introEnd; i++) {
    if (/\.\.(\s|$)/.test(lines[i]) && lines[i].split('..').length >= 3) {
      abbrevIdx = i
      break
    }
  }
  const descriptionEnd = abbrevIdx >= 0 ? abbrevIdx : introEnd
  const description = lines
    .slice(2, descriptionEnd)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/;$/, '')
    .trim()

  // ── Parse stages ──
  // A stage starts with lines up to (but not including) the "Status Exchange …"
  // header, then companies follow until the next stage header or EOF.
  const stages = []
  if (headerStart === -1) {
    return { code: block.code, label, description, stages }
  }

  // Collect headerStart positions for every stage in this industry.
  const headerIdxs = []
  for (let i = 0; i < lines.length; i++) {
    if (/Status\s+Exchange\s+Ticker\s*\/\s*Code\s+Value\s+Chain\s+Role/i.test(lines[i])) {
      headerIdxs.push(i)
    }
  }

  for (let s = 0; s < headerIdxs.length; s++) {
    const hi = headerIdxs[s]
    const headerLine = lines[hi]
    // Case A: stage name is on the SAME line as the header, e.g.
    //   "Raw Materials, Glass & Chemicals Status Exchange Ticker / Code Value Chain Role"
    const sameLineMatch = headerLine.match(/^(.+?)\s+Status\s+Exchange\s+Ticker\s*\/\s*Code\s+Value\s+Chain\s+Role/i)
    let stageName = sameLineMatch ? sameLineMatch[1].trim() : ''

    // Case B: stage name wraps onto the previous 1–2 lines and the header line
    // is bare "Status Exchange Ticker / Code Value Chain Role".
    if (!stageName) {
      const nameLines = []
      for (let j = hi - 1; j >= 0; j--) {
        const l = lines[j]
        if (!l) break
        if (STATUS_RE.test(l)) break
        if (/\.\.(\s|$)/.test(l) && l.split('..').length >= 3) break
        if (s === 0 && j < descriptionEnd) break
        nameLines.unshift(l.trim())
        if (nameLines.length === 2) break
      }
      stageName = nameLines.join(' ').replace(/\s+/g, ' ').trim()
    }
    if (!stageName) stageName = `Stage ${s + 1}`

    // Companies: all lines between this header and the next stage name block.
    const nextHi = s + 1 < headerIdxs.length ? headerIdxs[s + 1] : lines.length
    // next stage name block size = number of lines before its header that are
    // part of the name. Approximate: 1 line unless non-empty 2nd line exists.
    let bodyEnd = nextHi
    if (s + 1 < headerIdxs.length) {
      const candidate = nextHi - 1
      let k = candidate
      while (k > hi && lines[k] && !STATUS_RE.test(lines[k]) &&
             !/\.\.(\s|$)/.test(lines[k])) k--
      bodyEnd = k + 1
    }
    const body = lines.slice(hi + 1, bodyEnd).filter(Boolean)
    const companies = parseCompanies(body)
    stages.push({
      id: `${block.code.toLowerCase()}_${slug(stageName)}`,
      name: stageName,
      description: '', // Will be filled in later (see descriptions.js lookup)
      companies,
    })
  }

  return { code: block.code, label, description, stages }
}

/**
 * Given the body lines of a stage (no header), extract company records.
 *
 * Heuristic: lines containing a STATUS token start a new company. The company
 * line has layout:  <name tokens...> STATUS <exchange tokens...> <ticker_or_dash> [role...]
 * but the ticker and role often wrap onto subsequent lines. Treat everything
 * after the STATUS token up to the next STATUS-bearing line as "tail", split
 * into exchange / ticker / role by these rules:
 *   • exchange runs until we see a token that looks like a ticker: all-caps
 *     alnum ≥3 chars OR "—" OR "-" OR a parenthesised code like "(NYSE: DD)"
 *   • everything after the ticker (or dash) is the role text
 */
function parseCompanies(body) {
  // Group lines by status-bearing lines as anchors.
  const anchors = []
  for (let i = 0; i < body.length; i++) {
    if (STATUS_RE.test(body[i])) anchors.push(i)
  }
  if (anchors.length === 0) return []

  const records = []
  for (let a = 0; a < anchors.length; a++) {
    const start = anchors[a]
    const end = a + 1 < anchors.length ? anchors[a + 1] : body.length
    const chunk = body.slice(start, end)
    const statusLine = chunk[0]
    const m = statusLine.match(STATUS_RE)
    if (!m) continue
    const status = m[1]
    const beforeStatus = statusLine.slice(0, m.index).trim()
    const afterStatus = statusLine.slice(m.index + m[0].length).trim()
    if (!beforeStatus) continue // malformed

    // Combine after-status line with subsequent wrap lines
    const tailLines = [afterStatus, ...chunk.slice(1)]
    const tail = tailLines.join(' ').replace(/\s+/g, ' ').trim()

    // Split tail → exchange / ticker / role
    let exchange = ''
    let ticker = ''
    let role = ''

    // If tail starts with a parenthesised code (common for subsidiaries), treat
    // it as exchange context: e.g. "Subsidiary (NYSE: DD) — POE + EVA…"
    // Otherwise split the first word(s) as exchange.
    // Pattern 1: "Non-Listed (…) — role"
    // Pattern 2: "Subsidiary (…) — role"
    // Pattern 3: "NSE BORORENEW Solar tempered glass…"
    // Pattern 4: "BSE SME MAANALUM Aluminium section…"
    // Pattern 5: "NSE (parent: TATASTEEL) — Captive iron ore…"
    // Pattern 6: "ETR: WCH (Germany) WCH GR Polysilicon — …"

    const subsidiaryMatch = tail.match(/^(Subsidiary|Non-Listed|Private|JV|Govt\/PSU)\b([^—\-]*?)(—|\u2014|- )(.*)$/i)
    if (subsidiaryMatch) {
      exchange = (subsidiaryMatch[1] + ' ' + (subsidiaryMatch[2] || '')).trim()
      ticker = '—'
      role = subsidiaryMatch[4].trim()
    } else {
      // Strip any parenthesised exchange context up front e.g. "NSE (parent: X)"
      const parenLead = tail.match(/^([A-Za-z ]+?)\s*(\([^)]+\))\s*(.*)$/)
      if (parenLead) {
        exchange = (parenLead[1] + ' ' + parenLead[2]).trim()
        const rest = parenLead[3]
        // Ticker = first whitespace-separated token that is uppercase-alnum ≥2
        const tk = rest.match(/^([A-Z0-9][A-Z0-9&\-]{1,30})(?:\s+(.*))?$/)
        if (tk) {
          ticker = tk[1]
          role = (tk[2] || '').trim()
        } else {
          ticker = '—'
          role = rest.trim()
        }
      } else {
        // Split on whitespace; first token is exchange, may be multi-word if
        // exchange contains "SME" or "Emerge"
        const toks = tail.split(/\s+/)
        // Known multi-word exchange prefixes
        const multi = ['BSE SME', 'NSE Emerge']
        let mx = ''
        for (const p of multi) {
          if (tail.startsWith(p + ' ')) { mx = p; break }
        }
        if (mx) {
          exchange = mx
          const rest = tail.slice(mx.length + 1)
          const tk = rest.match(/^(\S+)\s*(.*)$/)
          if (tk) { ticker = tk[1]; role = tk[2].trim() } else { ticker = '—'; role = '' }
        } else {
          exchange = toks[0] || ''
          ticker = toks[1] || '—'
          role = toks.slice(2).join(' ').trim()
        }
      }
    }

    // Clean role: drop leading em-dash
    role = role.replace(/^[—\u2014\-]\s*/, '').trim()
    // If the role contains a merge of "code role", e.g. "WCH GR Polysilicon — primary…"
    // keep as-is; callers can post-process if needed.

    records.push({
      name: beforeStatus,
      status,
      exchange,
      ticker,
      role,
    })
  }
  return records
}

// ── Stage descriptions from the XLSX (Wind spotlight) and generic mapping ──
// This map gives a one-liner for each stage across industries, keyed by the
// lowercase stage name. We pre-populate common stages; admin can edit later
// via the Industries tab.
const STAGE_DESCRIPTIONS = {
  // Solar PV
  'raw materials, glass & chemicals':
    'Solar-grade glass, EVA encapsulants, aluminium frames, copper conductors, polysilicon feedstock.',
  'wafer, cell & module manufacturing':
    'Mono/poly wafers, PERC/TOPCon/HJT cells, c-Si module assembly lines.',
  'inverter, tracker & power electronics':
    'String + central inverters, MPPT, single/dual-axis trackers, power optimizers.',
  'epc, project development & ipp':
    'Utility + rooftop EPC, project dev, independent power producers, PPA origination.',
  'o&m, grid integration & digital solar':
    'Asset O&M, SCADA/cloud monitoring, grid-connection engineering, curtailment management.',
  // EV
  'battery raw materials & chemicals':
    'Lithium, graphite, cobalt-free cathodes, electrolytes, separators, current collectors.',
  'battery cell & pack manufacturing':
    'Prismatic/cylindrical/pouch cell lines, BMS, module + pack assembly.',
  'ev two-wheeler & three-wheeler oems':
    'Electric 2W + 3W OEMs and conversion kit specialists.',
  'ev four-wheeler & commercial oems':
    'Passenger EV and commercial vehicle OEMs (buses, LCVs, HCVs).',
  'charging infrastructure':
    'AC + DC fast chargers, CPO networks, grid-tied hardware and charging software stacks.',
  'battery recycling & second life':
    'End-of-life cell recycling, black-mass recovery, stationary second-life deployment.',
  // Steel
  'iron ore, coal & mining':
    'Iron ore + coking/thermal coal mining; manganese + limestone extraction.',
  'pelletising, sinter, dri & sponge iron':
    'Ore beneficiation, pelletisation, sinter plants and direct reduced iron.',
  'integrated steelmaking':
    'Blast furnace-BOF + EAF routes, primary steel production, alloys.',
  'rolling, tubes, wires & special steels':
    'Hot/cold rolled coil, tubes, wires, special steels, alloy forging.',
  'steel service centres, distribution & green steel':
    'Steel distribution, service centres, and H2-DRI / green steel initiatives.',
  // Wind (from XLSX spotlight)
  'raw materials, composites & key components':
    'High-strength steel, aluminium/copper conductors, bearings (SKF/Timken/Schaeffler), glass/carbon fibre, epoxy + core materials for blades.',
  'blade manufacturing':
    'Epoxy-infused glass/carbon fibre blades; OEM captive + merchant suppliers.',
  'wind tower & structural fabrication':
    'Rolled-plate tower sections, anchor cages, foundations; onshore + offshore.',
  'nacelle, generator & drivetrain':
    'Gearboxes (Flender + Winergy), generators (BHEL + ABB), main bearings, pitch/yaw systems.',
  'wind turbine oem & assembly':
    'Suzlon, Inox Wind, Siemens Gamesa, Vestas, GE Vernova, Enercon nacelle assembly.',
  'wind farm epc & ipp':
    'Utility wind EPC contractors and IPPs (Adani Green, ReNew, Torrent, JSW, Sterling).',
  'grid integration & transmission':
    'Wind farm substations, HVDC/HVAC cables, FACTS/SVC, POWERGRID evacuation.',
  'o&m, digital, repowering':
    'Component swaps, blade repair, SCADA + digital twins, old-site repowering.',
}

function applyStageDescriptions(industry) {
  for (const stg of industry.stages) {
    const key = stg.name.toLowerCase()
    if (STAGE_DESCRIPTIONS[key]) stg.description = STAGE_DESCRIPTIONS[key]
  }
}

function main() {
  const lines = loadRawLines()
  const blocks = splitByIndustry(lines)
  const industries = blocks.map(parseIndustry)
  industries.forEach(applyStageDescriptions)
  // Attach icons
  const ICONS = {
    I01: '☀', I02: '🔋', I03: '⚙', I04: '💊', I05: '🧪',
    I06: '🔌', I07: '👕', I08: '🛒', I09: '🏗', I10: '🛡',
    I11: '💻', I12: '🌾', I13: '🏭', I14: '🚢', I15: '🌬',
  }
  for (const ind of industries) {
    ind.id = slug(ind.label)
    ind.icon = ICONS[ind.code] || '◆'
  }

  // Clean up O&M; → O&M artefacts from PDF parse, then merge same-named stages
  const cleanName = (s) => s.replace(/&;/g, '&').replace(/;$/, '').trim()
  for (const ind of industries) {
    const merged = new Map()
    for (const stg of ind.stages) {
      stg.name = cleanName(stg.name)
      stg.id = `${ind.code.toLowerCase()}_${slug(stg.name)}`
      if (merged.has(stg.name)) {
        // Append companies, dedupe by name
        const target = merged.get(stg.name)
        const seenNames = new Set(target.companies.map((c) => c.name))
        for (const c of stg.companies) {
          if (!seenNames.has(c.name)) {
            target.companies.push(c)
            seenNames.add(c.name)
          }
        }
        if (!target.description && stg.description) target.description = stg.description
      } else {
        merged.set(stg.name, stg)
      }
    }
    ind.stages = Array.from(merged.values())
  }
  // Clean role and status text similarly
  for (const ind of industries) {
    for (const stg of ind.stages) {
      for (const c of stg.companies) {
        c.name = c.name.replace(/&;/g, '&').trim()
        c.role = c.role.replace(/&;/g, '&').trim()
        c.exchange = c.exchange.replace(/&;/g, '&').trim()
      }
    }
  }

  const totalStages = industries.reduce((a, i) => a + i.stages.length, 0)
  const totalCompanies = industries.reduce(
    (a, i) => a + i.stages.reduce((b, s) => b + s.companies.length, 0),
    0
  )

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(
    OUT,
    JSON.stringify({ industries, generatedAt: new Date().toISOString() }, null, 2)
  )
  console.log(
    `[parse-atlas] industries=${industries.length} stages=${totalStages} companies=${totalCompanies} → ${path.relative(process.cwd(), OUT)}`
  )
}

main()
