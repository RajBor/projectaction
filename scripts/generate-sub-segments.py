"""Regenerate src/lib/data/sub-segments.ts from the DealNector VC Taxonomy
Excel master. Run whenever the Excel changes.

Usage:
    python scripts/generate-sub-segments.py
Source:
    D:\\Finance\\DealNector_VC_Taxonomy.xlsx  (override via TAXONOMY_XLSX env var)
"""
import json
import os
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd

XLSX = os.environ.get('TAXONOMY_XLSX', r'D:\Finance\DealNector_VC_Taxonomy.xlsx')
OUT = r'C:\Users\RAJ\projectaction\src\lib\data\sub-segments.ts'


def ts_str(s):
    return str(s).replace('\\', '\\\\').replace("'", "\\'")


def main():
    df = pd.read_excel(XLSX, sheet_name=0, header=3)

    # Industry-name → Excel industry code (e.g. 'Solar PV…' → '1')
    ind_name_to_code = {}
    cur_ind = None
    for _, row in df.iterrows():
        ind = row['Industry'] if pd.notna(row['Industry']) else None
        stg_code = row['VC Stage #'] if pd.notna(row['VC Stage #']) else None
        if ind:
            cur_ind = ind
        if stg_code and cur_ind and cur_ind not in ind_name_to_code:
            ind_name_to_code[cur_ind] = str(stg_code).split('.')[0]

    # Walk rows, emit stages + subs
    stages = []
    cur_ind_code = None
    cur_stage = None
    for _, row in df.iterrows():
        ind = row['Industry'] if pd.notna(row['Industry']) else None
        stg_code = row['VC Stage #'] if pd.notna(row['VC Stage #']) else None
        stg_name = row['Value Chain Stage'] if pd.notna(row['Value Chain Stage']) else None
        sub_code = row['Sub-Segment #'] if pd.notna(row['Sub-Segment #']) else None
        sub_name = row['Sub-Segment / Product Type'] if pd.notna(row['Sub-Segment / Product Type']) else None

        if ind:
            cur_ind_code = ind_name_to_code[ind]
        if stg_code:
            cur_stage = {
                'code': str(stg_code),
                'name': str(stg_name) if stg_name else '',
                'industryCode': cur_ind_code,
                'subs': [],
            }
            stages.append(cur_stage)
        if sub_code and sub_name and cur_stage:
            code_str = str(sub_code).strip()
            sub_id = 'ss_' + code_str.replace('.', '_')
            cur_stage['subs'].append({
                'id': sub_id,
                'code': code_str,
                'name': str(sub_name).strip(),
            })

    # site sec id → Excel industry code (multiple aliases per industry)
    INDUSTRY_ALIASES = {
        '1': ['solar'],
        '2': ['wind', 'wind_energy', 'windenergy'],
        '3': ['ev_battery', 'ev', 'battery', 'storage', 'ev_storage',
              'electric_vehicles', 'battery_storage'],
        '4': ['steel', 'metals', 'steel_metals'],
        '5': ['pharma', 'pharmaceuticals', 'healthcare', 'pharma_health'],
        '6': ['chemicals', 'specialty_chem', 'specialty_chemicals', 'agrochemicals'],
        '7': ['semicon', 'semiconductors', 'electronics',
              'semiconductors_electronics'],
        '8': ['textiles', 'textile', 'apparel'],
        '9': ['fmcg', 'consumer', 'consumer_products'],
        '10': ['infra', 'infrastructure', 'construction', 'infra_construction'],
        '11': ['defence', 'defense', 'aerospace', 'defence_aerospace'],
        '12': ['it', 'tech', 'it_tech', 'technology', 'it_services'],
        '13': ['agri', 'agribusiness', 'food', 'food_processing'],
        '14': ['cement', 'building_materials'],
        '15': ['shipping', 'maritime', 'shipping_maritime'],
    }

    # Hardcoded CHAIN node id → Excel stage code (for solar + td core chain)
    COMP_MAP = {
        'polysilicon': '1.1', 'silver_paste': '1.1', 'pv_glass': '1.1',
        'encapsulants': '1.1', 'al_frame': '1.1', 'backsheet': '1.1',
        'junction_box': '1.1', 'bus_ribbon': '1.1', 'mc4_connector': '1.1',
        'wafers': '1.2', 'solar_cells': '1.2', 'solar_modules': '1.2',
        'inverters': '1.3', 'mounting': '1.3',
        'power_transformers': '10.3', 'dist_transformers': '10.3',
        'acsr_conductors': '10.3', 'htls': '10.3', 'hv_cables': '10.3',
        'switchgear': '10.3', 'smart_meters': '10.3',
        'bess': '3.2', 'ems': '12.3',
    }

    L = []

    def push(line=''):
        L.append(line)

    push('// AUTO-GENERATED from DealNector VC Taxonomy (April 2026).')
    push('// 15 industries · 79 value-chain stages · 668 sub-segments.')
    push('// Edits here are lost on regeneration — change the Excel and re-run')
    push('// scripts/generate-sub-segments.py.')
    push('//')
    push('// A sub-segment sits underneath the existing value-chain segment')
    push('// (Company.comp) and lets admins classify a company more precisely')
    push("// for peer comparison (e.g. a 'solar_modules' company can further be")
    push('// tagged as TOPCon, HJT, bifacial, BIPV…). When a company covers all')
    push('// sub-variants the admin selects every chip. When the parent comp has')
    push('// no taxonomic sub-segments, getSubSegmentsForComp() returns [] and')
    push('// the UI hides the picker.')
    push('')
    push('export interface SubSegment {')
    push("  /** Stable id — 'ss_<code_with_dots_as_underscores>' e.g. ss_1_1_3. */")
    push('  id: string')
    push("  /** Dotted taxonomy code from the Excel master (e.g. '1.1.3'). */")
    push('  code: string')
    push('  /** Human-readable product/sub-segment name. */')
    push('  name: string')
    push("  /** Parent VC-stage code (e.g. '1.1'). */")
    push('  stageCode: string')
    push('  /** Parent VC-stage label. */')
    push('  stageName: string')
    push('  /** Industry code (1..15) from the Excel master. */')
    push('  industryCode: string')
    push('}')
    push('')
    push('export interface TaxonomyStage {')
    push('  code: string')
    push('  name: string')
    push('  industryCode: string')
    push('  subs: SubSegment[]')
    push('}')
    push('')

    push('export const TAXONOMY_STAGES: TaxonomyStage[] = [')
    for st in stages:
        push('  {')
        push("    code: '" + ts_str(st['code']) + "',")
        push("    name: '" + ts_str(st['name']) + "',")
        push("    industryCode: '" + ts_str(st['industryCode']) + "',")
        push('    subs: [')
        for s in st['subs']:
            push(
                "      { id: '" + s['id'] +
                "', code: '" + s['code'] +
                "', name: '" + ts_str(s['name']) +
                "', stageCode: '" + st['code'] +
                "', stageName: '" + ts_str(st['name']) +
                "', industryCode: '" + st['industryCode'] + "' },"
            )
        push('    ],')
        push('  },')
    push(']')
    push('')

    push('/** Flat list of every sub-segment across every industry. */')
    push('export const SUB_SEGMENTS: SubSegment[] = TAXONOMY_STAGES.flatMap((s) => s.subs)')
    push('')

    push('/**')
    push(' * Site industry id → Excel industry code (1..15). One entry per alias')
    push(' * because the app uses a few different names for the same industry')
    push(" * (Wind could be 'wind' or 'wind_energy'; EV/Storage could be a few).")
    push(' * td is deliberately absent — T&D comp ids are mapped directly via')
    push(" * COMP_TO_STAGE_CODE since the Excel taxonomy doesn't have a top-level")
    push(' * T&D industry (it rolls into Infrastructure > Urban T&D).')
    push(' */')
    push('export const INDUSTRY_ID_TO_CODE: Record<string, string> = {')
    for code, aliases in INDUSTRY_ALIASES.items():
        for a in aliases:
            push("  " + a + ": '" + code + "',")
    push('}')
    push('')

    push('/**')
    push(' * Hardcoded CHAIN-node id → Excel stage code. Atlas-added value-chain')
    push(' * stage ids (from industry_chain_nodes) inherit the sub-segment pool')
    push(" * from their parent industry since they don't round-trip a stage code.")
    push(' * If a comp has no stage mapping, the picker falls back to the full')
    push(' * industry pool.')
    push(' */')
    push('export const COMP_TO_STAGE_CODE: Record<string, string> = {')
    for k, v in COMP_MAP.items():
        push("  " + k + ": '" + v + "',")
    push('}')
    push('')

    push('function normSec(sec: string | null | undefined): string {')
    push('  return (sec || \'\').trim().toLowerCase()')
    push('}')
    push('')
    push('/** Return the Excel industry code (1..15) for a site sec id, or null. */')
    push('export function industryCodeFor(sec: string | null | undefined): string | null {')
    push('  const key = normSec(sec)')
    push('  if (!key) return null')
    push('  return INDUSTRY_ID_TO_CODE[key] ?? null')
    push('}')
    push('')
    push('/**')
    push(' * Return the sub-segments that belong to the stage that the given')
    push(' * (sec, comp) pair points to. If no stage mapping exists, fall back')
    push(' * to every sub-segment in the industry so the admin still has a')
    push(' * meaningful pool to work from.')
    push(' */')
    push('export function getSubSegmentsForComp(sec: string | null | undefined, comp: string | null | undefined): SubSegment[] {')
    push('  const compKey = (comp || \'\').trim()')
    push('  const stageCode = compKey ? COMP_TO_STAGE_CODE[compKey] : undefined')
    push('  if (stageCode) {')
    push('    const stage = TAXONOMY_STAGES.find((s) => s.code === stageCode)')
    push('    if (stage) return stage.subs')
    push('  }')
    push('  return getSubSegmentsForIndustry(sec)')
    push('}')
    push('')
    push('/** Every sub-segment defined for the given site sec id. */')
    push('export function getSubSegmentsForIndustry(sec: string | null | undefined): SubSegment[] {')
    push('  const code = industryCodeFor(sec)')
    push('  if (!code) return []')
    push('  return TAXONOMY_STAGES.filter((s) => s.industryCode === code).flatMap((s) => s.subs)')
    push('}')
    push('')
    push('const BY_ID: Record<string, SubSegment> = Object.fromEntries(')
    push('  SUB_SEGMENTS.map((s) => [s.id, s])')
    push(')')
    push('')
    push('/** Reverse lookup — used by filter chips and table badges site-wide. */')
    push('export function getSubSegmentById(id: string): SubSegment | null {')
    push('  return BY_ID[id] ?? null')
    push('}')
    push('')
    push('/** Human label for a sub-segment id. Unknown ids fall back to the raw id. */')
    push('export function getSubSegmentLabel(id: string): string {')
    push('  return BY_ID[id]?.name ?? id')
    push('}')
    push('')

    out_text = '\n'.join(L)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(out_text)
    print('Wrote', OUT)
    print('  stages:', len(stages))
    print('  sub-segments:', sum(len(s['subs']) for s in stages))
    print('  bytes:', len(out_text))


if __name__ == '__main__':
    main()
