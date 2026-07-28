import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, Trash2, Edit2, X, Link2, Upload, FileText, Map, Beaker, Download, Sparkles, Loader2, Check, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import DigestSimulationPanel from '../components/DigestSimulation/DigestSimulationPanel'
import NormalizationDialog from '../components/NormalizationDialog'
import type { Vector, VectorEnzymeSite, VectorType, SmartMatchResult } from '../../shared/types'
import { useLifecycleLog, useModuleLogger } from '../hooks/useDebugLog'
import { useSmartAnnotation } from '../hooks/useSmartAnnotation'

const typeLabels: Record<string, string> = {
  plasmid: '质粒', phage: '噬菌体', cosmid: '黏粒', bac: 'BAC', yac: 'YAC', other: '其他'
}
const promoterTypeLabels: Record<string, string> = {
  constitutive: '组成型', inducible: '诱导型', tissue_specific: '组织特异性', none: '无', other: '其他'
}
const topologyLabels: Record<string, string> = { circular: '环形', linear: '线性' }
const purposeOptions = ['荧光蛋白表达', '过表达', 'CRISPR', '克隆载体', '表达载体', '报告载体', '穿梭载体', '敲除载体', '敲入载体', '农杆菌遗传转化']
const COMMON_RESISTANCE = [
  '氨苄青霉素(Ampicillin)', '卡那霉素(Kanamycin)', '氯霉素(Chloramphenicol)',
  '四环素(Tetracycline)', '壮观霉素(Spectinomycin)', '庆大霉素(Gentamicin)',
  '潮霉素(Hygromycin)', '嘌呤霉素(Puromycin)', '博来霉素(Zeocin)',
  '诺尔丝菌素(Nourseothricin)', '腐草霉素(Phleomycin)'
]

// === 辅助函数 ===
function parseJsonArray(s: string | undefined | null): string[] {
  if (!s) return []
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] }
}
function toJsonArray(arr: string[]): string { return JSON.stringify(arr) }

/** 复制子 → 宿主中文名映射（含中文关键词支持） */
const ORI_HOST_MAP: Record<string, string> = {
  'puc': '大肠杆菌', 'cole1': '大肠杆菌', 'colE1': '大肠杆菌', 'pbr322': '大肠杆菌',
  'f1': '大肠杆菌', 'm13': '大肠杆菌', 'p15a': '大肠杆菌', 'cloDF13': '大肠杆菌',
  'cola': '大肠杆菌', 'colv': '大肠杆菌',
  'sv40': '哺乳动物', 'cmv': '哺乳动物', 'orip': '哺乳动物',
  '2mu': '酵母', '2μ': '酵母', 'ars': '酵母', 'cen': '酵母',
  '酵母': '酵母', 'micron': '酵母', '酿酒酵母': '酵母',
  'pvs2': '农杆菌', 'psa322': '农杆菌', 'prk2': '农杆菌',
  '农杆菌': '农杆菌',
  'pbbR1': '广谱宿主', 'oriv': '广谱宿主',
  'ama1': '真菌', '真菌': '真菌',
}
/** 启动子 → 宿主中文名映射 */
const PROMOTER_HOST_MAP: Record<string, string> = {
  't7': '大肠杆菌', 'lac': '大肠杆菌', 'tac': '大肠杆菌', 'ara': '大肠杆菌', 'tet': '大肠杆菌',
  '35s': '植物', 'camv': '植物', 'ubi': '植物', 'ubq': '植物', '植物': '植物',
  'cmv': '人', 'ef1': '人', 'sv40': '人', 'gapdh': '人', 'actin': '人',
  'adh': '酵母', 'gal': '酵母', '酵母': '酵母',
  'polh': '昆虫', 'p10': '昆虫',
}

/** 报告基因关键词 */
const REPORTER_KEYWORDS = ['gfp', 'egfp', 'sfGFP', 'mcherry', 'rfp', 'dsred', 'yfp', 'cfp', 'venus', 'mVenus',
  'luc', 'luciferase', 'fluc', 'rluc', 'lacz', 'beta-gal', 'gus', 'uidA', 'seap', 'secreted alkaline phosphatase']

// === 模块聚类 ===
interface Module { elements: SmartMatchResult[]; start: number; end: number; type: 'resistance' | 'mcs' | 'functional' }

function clusterModules(matches: SmartMatchResult[]): Module[] {
  const sorted = [...matches].sort((a, b) => a.match_start - b.match_start)
  const modules: Module[] = []
  let cur: SmartMatchResult[] = []
  for (const m of sorted) {
    if (cur.length > 0 && m.match_start - cur[cur.length - 1].match_end > 500) {
      modules.push(buildModule(cur))
      cur = []
    }
    cur.push(m)
  }
  if (cur.length > 0) modules.push(buildModule(cur))
  return modules
}

function buildModule(elems: SmartMatchResult[]): Module {
  const start = Math.min(...elems.map(e => e.match_start))
  const end = Math.max(...elems.map(e => e.match_end))
  const hasResistance = elems.some(e => e.component_type === 'resistance')
  const mcsKeywords = ['mcs', 'polylinker', 'multiple cloning', 'restriction site']
  const hasMCS = elems.some(e => mcsKeywords.some(k => e.match_component_name.toLowerCase().includes(k)))
  const type = hasResistance ? 'resistance' : hasMCS ? 'mcs' : 'functional'
  return { elements: elems, start, end, type }
}

// === 分类推断结果 ===
interface ClassificationInference {
  antibiotic_resistance: string
  host_type: string       // JSON数组 ["大肠杆菌"]
  promoters: string       // JSON数组 ["大肠杆菌 T7"]
  promoter_type: string
  purpose: string
  reporter_gene: string
  is_recombinant: boolean
  directions: Array<{ name: string; strand: 1 | -1 }>
}

/** 从复制子推断宿主 — 不再 break，收集所有匹配的宿主 */
function inferHostsFromOrigins(matches: SmartMatchResult[]): string[] {
  const hosts = new Set<string>()
  const originMatches = matches.filter(x => x.component_type === 'origin')
  console.log(`[inferHostsFromOrigins] Checking ${originMatches.length} origin matches`)
  for (const m of originMatches) {
    const name = m.match_component_name.toLowerCase()
    console.log(`[inferHostsFromOrigins]   Origin: "${m.match_component_name}" (lowercase: "${name}")`)
    for (const [key, host] of Object.entries(ORI_HOST_MAP)) {
      if (name.includes(key.toLowerCase())) {
        console.log(`[inferHostsFromOrigins]     → matched key "${key}" → host "${host}"`)
        hosts.add(host)
      }
    }
  }
  console.log(`[inferHostsFromOrigins] Final hosts: [${Array.from(hosts).join(', ')}]`)
  return Array.from(hosts)
}

/** 从启动子推断宿主 */
function inferHostFromPromoter(promoterName: string): string {
  const lower = promoterName.toLowerCase()
  for (const [key, host] of Object.entries(PROMOTER_HOST_MAP)) {
    if (lower.includes(key.toLowerCase())) return host
  }
  return ''
}

/** 重写：根据已确认的元件匹配结果推断载体分类 */
function inferClassification(matches: SmartMatchResult[]): ClassificationInference {
  const result: ClassificationInference = {
    antibiotic_resistance: '', host_type: '[]', promoters: '[]',
    promoter_type: 'none', purpose: '', reporter_gene: '', is_recombinant: false,
    directions: matches.map(m => ({ name: m.match_component_name, strand: m.strand }))
  }

  // 1. 模块聚类
  console.log(`[inferClassification] Total matches: ${matches.length}`)
  const modules = clusterModules(matches)
  console.log(`[inferClassification] Modules: ${modules.map(m => `${m.type}[${m.elements.map(e => e.match_component_name).join(',')}]`).join(' | ')}`)
  const resistanceModules = modules.filter(m => m.type === 'resistance')
  const mcsModules = modules.filter(m => m.type === 'mcs')
  const functionalModules = modules.filter(m => m.type === 'functional')
  const allResistanceElements = resistanceModules.flatMap(m => m.elements)
  const allMcsElements = mcsModules.flatMap(m => m.elements)
  const functionalElements = functionalModules.flatMap(m => m.elements)
  
  // 诊断：列出所有匹配到的 origin 元件
  const originMatches = matches.filter(x => x.component_type === 'origin')
  console.log(`[inferClassification] Origin matches: ${originMatches.map(m => `"${m.match_component_name}"`).join(', ') || 'NONE'}`)
  
  // 诊断：列出所有 component_type === 'resistance' 的匹配
  const resistanceMatches = matches.filter(x => x.component_type === 'resistance')
  console.log(`[inferClassification] Resistance matches: ${resistanceMatches.map(m => `"${m.match_component_name}"`).join(', ') || 'NONE'}`)

  // 2. 抗生素抗性（中英文标注格式）
  const resistanceMap: Record<string, string> = {
    'ampr': '氨苄青霉素(Ampicillin)', 'bla': '氨苄青霉素(Ampicillin)', 'amp': '氨苄青霉素(Ampicillin)',
    'kanr': '卡那霉素(Kanamycin)', 'nptii': '卡那霉素(Kanamycin)', 'neo': '卡那霉素(Kanamycin)',
    'aph(3\')': '卡那霉素(Kanamycin)', 'nos-nptii': '卡那霉素(Kanamycin)',
    'cat': '氯霉素(Chloramphenicol)', 'cmr': '氯霉素(Chloramphenicol)',
    'tetr': '四环素(Tetracycline)', 'tcr': '四环素(Tetracycline)',
    'specr': '壮观霉素(Spectinomycin)', 'aada': '壮观霉素(Spectinomycin)', 'smr': '壮观霉素(Spectinomycin)',
    'gentr': '庆大霉素(Gentamicin)', 'aacC1': '庆大霉素(Gentamicin)', 'aacC': '庆大霉素(Gentamicin)', 'gmr': '庆大霉素(Gentamicin)',
    'hygr': '潮霉素(Hygromycin)', 'aph(4)': '潮霉素(Hygromycin)',
    'puror': '嘌呤霉素(Puromycin)',
    'zeor': '博来霉素(Zeocin)', 'bleo': '博来霉素(Zeocin)', 'ble': '博来霉素(Zeocin)', 'sh ble': '博来霉素(Zeocin)',
    'natr': '诺尔丝菌素(Nourseothricin)',
    'bsd': '杀稻瘟菌素(Blasticidin)',
    'phleo': '腐草霉素(Phleomycin)',
  }
  const antibiotics = new Set<string>()
  // 仅处理 component_type === 'resistance' 的元件，避免非抗性元件误标为「未知抗性」
  const filteredResistanceElements = allResistanceElements.filter(e => e.component_type === 'resistance')
  console.log(`[inferClassification] Processing ${filteredResistanceElements.length} resistance elements from resistance modules`)
  for (const m of filteredResistanceElements) {
    const key = m.match_component_name.toLowerCase().replace(/[\s_]+/g, '')
    console.log(`[inferClassification] Checking resistance element: "${m.match_component_name}" → key="${key}"`)
    let found = false
    for (const [gene, ab] of Object.entries(resistanceMap)) {
      const geneKey = gene.toLowerCase().replace(/[\s_]+/g, '')
      if (key.includes(geneKey)) { 
        console.log(`[inferClassification]   ✓ Matched: gene="${gene}" (key="${geneKey}") → "${ab}"`)
        antibiotics.add(ab); found = true; break 
      }
    }
    if (!found) {
      console.log(`[inferClassification]   ✗ No match → adding '未知抗性'`)
      antibiotics.add('未知抗性')
    }
  }
  result.antibiotic_resistance = Array.from(antibiotics).join(', ')
  console.log(`[inferClassification] Final antibiotic_resistance: "${result.antibiotic_resistance}"`)

  // 3. 宿主类型（主要从复制子推断）
  let hosts = inferHostsFromOrigins(matches)
  console.log(`[inferClassification] Hosts from origins: [${hosts.join(', ')}]`)
  // 始终合并启动子推断的宿主（不再仅作为回退）
  const promoterHosts = new Set<string>()
  for (const m of matches.filter(x => x.component_type === 'promoter')) {
    const h = inferHostFromPromoter(m.match_component_name)
    if (h) promoterHosts.add(h)
  }
  for (const h of promoterHosts) hosts.push(h)
  // 回退：从元件名称
  if (hosts.length === 0) {
    const namePatterns: [string, string][] = [
      ['e.coli', '大肠杆菌'], ['ecoli', '大肠杆菌'], ['hek293', '哺乳动物'], ['hela', '哺乳动物'],
      ['yeast', '酵母'], ['arabidopsis', '植物'], ['tobacco', '植物'], ['rice', '植物'],
      ['sf9', '昆虫'], ['drosophila', '昆虫'], ['bacillus', '芽孢杆菌']
    ]
    const allNames = matches.map(m => m.match_component_name.toLowerCase()).join(' ')
    for (const [p, h] of namePatterns) {
      if (allNames.includes(p) && !hosts.includes(h)) hosts.push(h)
    }
  }
  // 去重
  hosts = [...new Set(hosts)]
  result.host_type = toJsonArray(hosts)

  // 4. 启动子（格式：「中文宿主名 + 启动子缩写」）
  const promoterEntries: string[] = []
  const promoterMatches = matches.filter(m => m.component_type === 'promoter')
  for (const pm of promoterMatches) {
    const hostName = inferHostFromPromoter(pm.match_component_name) || (hosts[0] || '')
    // 提取启动子缩写（取标准名称前20字符）
    const abbr = pm.match_component_name.length > 20 ? pm.match_component_name.substring(0, 20) : pm.match_component_name
    promoterEntries.push(hostName ? `${hostName} ${abbr}` : abbr)
  }
  result.promoters = toJsonArray(promoterEntries)

  // 5. 启动子分类
  if (promoterMatches.length > 0) {
    const pNames = promoterMatches.map(m => m.match_component_name.toLowerCase())
    const inducible = ['t7', 'lac', 'tac', 'ara', 'tet', 'gal', 'rha', 'dox', 'cumate']
    const constitutive = ['ef1', 'ubiquitin', 'ubi', 'cmv', 'sv40', 'actin', 'gapdh', '35s']
    if (pNames.some(n => ['insulin', 'synapsin', 'gfap'].some(k => n.includes(k)))) result.promoter_type = 'tissue_specific'
    else if (pNames.some(n => inducible.some(k => n.includes(k)))) result.promoter_type = 'inducible'
    else if (pNames.some(n => constitutive.some(k => n.includes(k)))) result.promoter_type = 'constitutive'
    else result.promoter_type = 'other'
  }

  // 6. 目的推断（基于模块位置关系的综合分析）
  // 收集各类型模块的位置信息
  const promoterModules = modules.filter(m =>
    m.elements.some(e => e.component_type === 'promoter'))
  const terminatorModules = modules.filter(m =>
    m.elements.some(e => e.component_type === 'terminator' ||
      /poly[aA]|nos.?t|NOS|CaMV|poly.?A/i.test(e.match_component_name)))

  /** 检查模块 A 是否在模块 B 上游（A.start < B.start）*/
  const isUpstream = (a: Module, b: Module) => a.start < b.start
  /** 检查两个模块是否相邻（间距 < 1500bp，中间无其他功能模块）*/
  const areAdjacent = (a: Module, b: Module) => {
    const gap = Math.min(Math.abs(a.end - b.start), Math.abs(b.end - a.start))
    if (gap > 1500) return false
    const between = modules.filter(m => m !== a && m !== b &&
      m.start > Math.min(a.start, b.start) && m.end < Math.max(a.end, b.end))
    // 中间最多允许一个小型间隔模块
    return between.filter(m => m.type === 'functional').length <= 1
  }
  /** 检查模块是否在另一模块下游（start > 另一模块）*/
  const isDownstreamOf = (cds: Module, prom: Module) => cds.start > prom.start

  // === 候选推断及其完整度评分 ===
  const candidates: { purpose: string; score: number }[] = []

  // 6a. CRISPR：Cas9 CDS 与 gRNA/sgRNA 在同一或相邻模块
  const cas9Elements = matches.filter(m => {
    const n = m.match_component_name.toLowerCase()
    return n.includes('cas9') || n.includes('cas12')
  })
  const grnaElements = matches.filter(m => {
    const n = m.match_component_name.toLowerCase()
    return n.includes('grna') || n.includes('sgrna') || n.includes('guide')
  })
  if (cas9Elements.length > 0 || grnaElements.length > 0) {
    let score = 0
    if (cas9Elements.length > 0) score += 2
    if (grnaElements.length > 0) score += 2
    // 位置接近度加分
    if (cas9Elements.length > 0 && grnaElements.length > 0) {
      const cas9Mod = modules.find(m => m.elements.includes(cas9Elements[0]))
      const grnaMod = modules.find(m => m.elements.includes(grnaElements[0]))
      if (cas9Mod && grnaMod && areAdjacent(cas9Mod, grnaMod)) score += 3
    }
    candidates.push({ purpose: 'CRISPR', score })
  }

  // 6b. 荧光蛋白表达：荧光 CDS 位于启动子下游同一/相邻功能区域
  const fluorescentElements = functionalElements.filter(m =>
    (m.component_type === 'CDS' || m.component_type === 'reporter') &&
    REPORTER_KEYWORDS.some(k => m.match_component_name.toLowerCase().includes(k.toLowerCase())))
  if (fluorescentElements.length > 0 && promoterModules.length > 0) {
    const fpModule = modules.find(m => m.elements.includes(fluorescentElements[0]))
    let score = 2 // 有荧光蛋白 CDS 基础分
    if (fpModule) {
      // 检查是否有启动子在荧光蛋白上游
      const upstreamProm = promoterModules.find(p => isDownstreamOf(fpModule, p))
      if (upstreamProm) {
        score += 2
        if (areAdjacent(fpModule, upstreamProm)) score += 2 // 紧邻加分
      }
      // 检查下游是否有终止子
      const downstreamTerm = terminatorModules.find(t => isDownstreamOf(t, fpModule))
      if (downstreamTerm) score += 1
    }
    candidates.push({ purpose: '荧光蛋白表达', score })
  }

  // 6c. 过表达：启动子→MCS→终止子 按位置顺序排列
  if (promoterModules.length > 0 && mcsModules.length > 0) {
    const overexpPromoters = promoterModules.filter(pm =>
      pm.elements.some(e => {
        const n = e.match_component_name.toLowerCase()
        return n.includes('35s') || n.includes('ubi') || n.includes('ubq') ||
               n.includes('cmv') || n.includes('ef1') || n.includes('actin')
      }))
    // 对每个过表达候选启动子，检查是否形成 promoter→MCS→terminator 排列
    for (const op of (overexpPromoters.length > 0 ? overexpPromoters : promoterModules)) {
      const orderedMcs = mcsModules.find(mc => isDownstreamOf(mc, op))
      if (!orderedMcs) continue
      const orderedTerm = terminatorModules.find(t =>
        isDownstreamOf(t, orderedMcs) && t.start > op.start)
      let score = 1
      if (orderedMcs) score += 2
      if (orderedTerm) score += 2
      if (orderedMcs && orderedTerm && isDownstreamOf(orderedMcs, op) && isDownstreamOf(orderedTerm, orderedMcs)) {
        score += 3 // 三者完美顺序加分
      }
      if (overexpPromoters.includes(op)) score += 2 // 典型过表达启动子加分
      candidates.push({ purpose: '过表达', score })
    }
  }

  // 6d. 农杆菌遗传转化：T-DNA LB/RB 分列载体两端，功能元件在中间
  const tdnaLb = matches.find(m => {
    const n = m.match_component_name.toLowerCase()
    return n.includes('left border') || (n.includes('t-dna') && n.includes('lb'))
  })
  const tdnaRb = matches.find(m => {
    const n = m.match_component_name.toLowerCase()
    return n.includes('right border') || (n.includes('t-dna') && n.includes('rb'))
  })
  if (tdnaLb || tdnaRb) {
    let score = 2 // 有 T-DNA 边界基础分
    const sortedMatches = [...matches].sort((a, b) => a.match_start - b.match_start)
    const totalLen = sortedMatches.length > 0 ? sortedMatches[sortedMatches.length - 1].match_end : 0
    // LB 应在载体前端（前 20%），RB 应在载体后端（后 20%）
    if (tdnaLb && tdnaRb) {
      score += 2
      const lbPos = tdnaLb.match_start / totalLen
      const rbPos = tdnaRb.match_end / totalLen
      if (lbPos < 0.3 && rbPos > 0.7) score += 3 // LB/RB 分列两端加分
      // 中间是否有功能元件
      const betweenElements = matches.filter(m =>
        m.match_start > Math.min(tdnaLb.match_start, tdnaRb.match_start) &&
        m.match_end < Math.max(tdnaLb.match_end, tdnaRb.match_end) &&
        m !== tdnaLb && m !== tdnaRb)
      if (betweenElements.length > 0) score += 2
    }
    candidates.push({ purpose: '农杆菌遗传转化', score })
  }

  // 按评分降序排列，取最高分候选
  candidates.sort((a, b) => b.score - a.score)
  if (candidates.length > 0) {
    // 当多个候选分数接近时（差距 ≤ 2），可同时保留
    const topScore = candidates[0].score
    const topCandidates = candidates.filter(c => c.score >= topScore - 2 && c.score >= 3)
    if (topCandidates.length > 0) {
      result.purpose = topCandidates.map(c => c.purpose).join(', ')
    } else {
      result.purpose = candidates[0].score >= 2 ? candidates[0].purpose : ''
    }
  }

  // 6e. 默认 fallback
  if (!result.purpose) {
    const cdsNearMcs = functionalElements.filter(m => m.component_type === 'CDS')
    if (cdsNearMcs.length > 0) {
      result.purpose = cdsNearMcs[0].match_component_name
    } else if (promoterMatches.length > 0 && functionalElements.some(m => m.component_type === 'CDS')) {
      result.purpose = '表达载体'
    }
  }

  // 7. 报告基因推断
  const reporters: string[] = []
  for (const m of functionalElements) {
    const isReporter = m.component_type === 'reporter' ||
      REPORTER_KEYWORDS.some(k => m.match_component_name.toLowerCase().includes(k.toLowerCase()))
    if (isReporter) reporters.push(m.match_component_name)
  }
  result.reporter_gene = reporters.join(', ')

  // 8. 重组质粒
  const hasCDS = matches.some(m => m.component_type === 'CDS')
  const hasPromoter = promoterMatches.length > 0
  result.is_recombinant = (hasCDS && hasPromoter && matches.length > 3) ||
    functionalElements.some(m => m.component_type === 'CDS')

  return result
}

// === 多值标签输入组件 ===
function TagInput({ values, onChange, placeholder, suggestions }: {
  values: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[]
}) {
  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const filtered = suggestions?.filter(s => s.toLowerCase().includes(input.toLowerCase()) && !values.includes(s)) || []

  const addTag = (tag: string) => {
    const t = tag.trim()
    if (t && !values.includes(t)) onChange([...values, t])
    setInput('')
    setShowSuggestions(false)
  }
  const removeTag = (idx: number) => onChange(values.filter((_, i) => i !== idx))

  return (
    <div className="border border-slate-200 rounded focus-within:ring-1 focus-within:ring-violet-400 bg-white">
      <div className="flex flex-wrap gap-1 p-1">
        {values.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded text-xs">
            {v}
            <button onClick={() => removeTag(i)} className="hover:text-red-500 ml-0.5"><X size={10} /></button>
          </span>
        ))}
        <div className="relative flex-1 min-w-[60px]">
          <input value={input} placeholder={values.length === 0 ? placeholder : ''}
            onChange={e => { setInput(e.target.value); setShowSuggestions(true) }}
            onKeyDown={e => {
              if (e.key === 'Enter' && input.trim()) { e.preventDefault(); addTag(input) }
              if (e.key === 'Backspace' && !input && values.length > 0) removeTag(values.length - 1)
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            className="w-full px-1 py-0.5 text-xs outline-none bg-transparent" />
          {showSuggestions && filtered.length > 0 && (
            <div className="absolute z-50 top-full left-0 w-48 mt-1 bg-white border border-slate-200 rounded shadow-lg max-h-32 overflow-auto">
              {filtered.slice(0, 8).map(s => (
                <div key={s} onClick={() => addTag(s)}
                  className="px-2 py-1 text-xs hover:bg-violet-50 cursor-pointer">{s}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function VectorPage() {
  useLifecycleLog('VectorPage')
  const log = useModuleLogger('VectorPage')

  const [vectors, setVectors] = useState<Vector[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedVector, setSelectedVector] = useState<Vector | null>(null)
  const [enzymeSites, setEnzymeSites] = useState<VectorEnzymeSite[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingVector, setEditingVector] = useState<Vector | null>(null)
  const [importMsg, setImportMsg] = useState('')
  const [showDigestPanel, setShowDigestPanel] = useState(false)
  const [exportMode, setExportMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [exportFormat, setExportFormat] = useState<'genbank' | 'fasta' | 'dna'>('genbank')
  const [exportLoading, setExportLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '', type: 'plasmid' as VectorType, size_bp: 0, description: '', sequence: '', backbone_id: null as number | null,
    purpose: '', host_type: '[]', promoter_type: 'none', promoters: '[]', reporter_gene: '',
    is_recombinant: false, antibiotic_resistance: '', copy_number: '', topology: 'circular',
    file_path: '', source_file: ''
  })

  // === 智能标注状态 ===
  const smartAnnotation = useSmartAnnotation()
  const [annotatingId, setAnnotatingId] = useState<number | null>(null)
  const [normalizationVector, setNormalizationVector] = useState<Vector | null>(null)
  const [classificationDialog, setClassificationDialog] = useState<{
    vector: Vector; inferred: ClassificationInference; draft: ClassificationInference
  } | null>(null)
  const [showDirections, setShowDirections] = useState(false)
  const [detailEditing, setDetailEditing] = useState(false)
  const [detailForm, setDetailForm] = useState({
    name: '', type: 'plasmid' as VectorType, size_bp: 0, description: '', topology: 'circular',
    purpose: '', host_type: '[]', promoter_type: 'none' as any, promoters: '[]', reporter_gene: '',
    is_recombinant: false, antibiotic_resistance: '', copy_number: ''
  })

  useEffect(() => {
    if (selectedVector) {
      setDetailForm({
        name: selectedVector.name, type: selectedVector.type, size_bp: selectedVector.size_bp,
        description: selectedVector.description || '', topology: selectedVector.topology || 'circular',
        purpose: selectedVector.purpose || '', host_type: selectedVector.host_type || '[]',
        promoter_type: selectedVector.promoter_type || 'none', promoters: selectedVector.promoters || '[]',
        reporter_gene: selectedVector.reporter_gene || '', is_recombinant: !!selectedVector.is_recombinant,
        antibiotic_resistance: selectedVector.antibiotic_resistance || '', copy_number: selectedVector.copy_number || ''
      })
      setDetailEditing(false)
    }
  }, [selectedVector?.id])

  const handleDetailSave = async () => {
    if (!selectedVector) return
    try {
      await window.api.updateVector(selectedVector.id, detailForm)
      log.info(`Detail updated: vector ${selectedVector.id}`)
      setDetailEditing(false); loadVectors()
    } catch (e: any) { alert(`更新失败: ${e.message || e}`) }
  }

  useEffect(() => { loadVectors() }, [])
  useEffect(() => { if (selectedVector) window.api.getVectorEnzymeSites(selectedVector.id).then(setEnzymeSites) }, [selectedVector])
  useEffect(() => { if (selectedVector) { const u = vectors.find(v => v.id === selectedVector.id); if (u) setSelectedVector(u) } }, [vectors])

  const loadVectors = async () => {
    log.info('Loading vectors...')
    try { const data = await window.api.getVectors(); log.info(`Loaded ${data.length} vectors`); setVectors(data) }
    catch (err) { log.error('Failed to load vectors', err) }
  }

  const handleImport = async () => {
    log.info('Importing vectors...')
    const result = await window.api.importVectors()
    if (result?.success) { log.info(`Imported ${result.count} vectors`); setImportMsg(`成功导入 ${result.count} 个载体`); loadVectors(); setTimeout(() => setImportMsg(''), 3000) }
  }

  const toggleSelectId = (id: number) => setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const toggleSelectAll = () => { selectedIds.size === filtered.length ? setSelectedIds(new Set()) : setSelectedIds(new Set(filtered.map(v => v.id))) }

  const handleBatchExport = async () => {
    if (selectedIds.size === 0) return
    setExportLoading(true)
    try {
      const result = await window.api.batchExportVectors(Array.from(selectedIds), exportFormat)
      if (result?.success) { const dir = result.paths.length > 1 ? result.paths[0].replace(/[/\\][^/\\]*$/, '') : result.paths[0]; setImportMsg(`成功导出 ${result.count} 个载体到: ${dir}`); setTimeout(() => setImportMsg(''), 5000) }
    } catch (e: any) { log.error('Export failed', e); setImportMsg(`导出失败: ${e.message || e}`); setTimeout(() => setImportMsg(''), 5000) }
    finally { setExportLoading(false); setExportMode(false); setSelectedIds(new Set()) }
  }

  const cancelExport = () => { setExportMode(false); setSelectedIds(new Set()) }
  const handleDelete = async (id: number) => { if (!confirm('确定删除此载体？')) return; log.info(`Deleting vector id=${id}`); await window.api.deleteVector(id); loadVectors(); if (selectedVector?.id === id) setSelectedVector(null) }

  const handleEdit = (v: Vector) => {
    setEditingVector(v)
    setFormData({ name: v.name, type: v.type, size_bp: v.size_bp, description: v.description, sequence: v.sequence, backbone_id: v.backbone_id,
      purpose: v.purpose || '', host_type: v.host_type || '[]', promoter_type: v.promoter_type || 'none',
      promoters: v.promoters || '[]', reporter_gene: v.reporter_gene || '',
      is_recombinant: !!v.is_recombinant, antibiotic_resistance: v.antibiotic_resistance || '',
      copy_number: v.copy_number || '', topology: v.topology || 'circular', file_path: v.file_path || '', source_file: v.source_file || '' })
    setShowForm(true)
  }

  const handleCreate = () => {
    setEditingVector(null)
    setFormData({ name: '', type: 'plasmid', size_bp: 0, description: '', sequence: '', backbone_id: null,
      purpose: '', host_type: '[]', promoter_type: 'none', promoters: '[]', reporter_gene: '',
      is_recombinant: false, antibiotic_resistance: '', copy_number: '', topology: 'circular', file_path: '', source_file: '' })
    setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!formData.name) return
    if (editingVector) { log.info(`Updating vector id=${editingVector.id}: ${formData.name}`); await window.api.updateVector(editingVector.id, formData) }
    else { log.info(`Creating vector: ${formData.name} (${formData.type})`); await window.api.createVector(formData as any) }
    setShowForm(false); loadVectors()
  }

  // === 智能标注流程 ===
  const handleSmartAnnotate = useCallback(async (v: Vector) => {
    if (!v.sequence) { alert('该载体无序列数据，无法执行智能标注'); return }
    setAnnotatingId(v.id); setNormalizationVector(v)
    // 全序列扫描：不依赖 features，直接用载体序列扫描元件数据库
    const result = await smartAnnotation.annotate(v.id)
    if (!result) {
      if (smartAnnotation.error) alert(smartAnnotation.error)
      setAnnotatingId(null); return
    }
    if (result.length === 0) {
      alert('未检测到有效的元件匹配（nt-nt ≥99% / nt-aa ≥90%）'); setAnnotatingId(null); return
    }
  }, [smartAnnotation])

  const handleNormalizationAccept = useCallback((accepted: SmartMatchResult[]) => {
    smartAnnotation.reset()
    if (!normalizationVector) { setAnnotatingId(null); return }
    const inferred = inferClassification(accepted)
    // 始终用推断值覆盖现有字段（重新分类）
    const draft: ClassificationInference = {
      antibiotic_resistance: inferred.antibiotic_resistance || normalizationVector.antibiotic_resistance || '',
      host_type: inferred.host_type !== '[]' ? inferred.host_type : (normalizationVector.host_type || '[]'),
      promoters: inferred.promoters !== '[]' ? inferred.promoters : (normalizationVector.promoters || '[]'),
      promoter_type: inferred.promoter_type !== 'none' ? inferred.promoter_type : (normalizationVector.promoter_type || 'none'),
      purpose: inferred.purpose || normalizationVector.purpose || '',
      reporter_gene: inferred.reporter_gene || normalizationVector.reporter_gene || '',
      is_recombinant: inferred.is_recombinant || !!normalizationVector.is_recombinant,
      directions: inferred.directions
    }
    setClassificationDialog({ vector: normalizationVector, inferred, draft })
  }, [normalizationVector, smartAnnotation.reset])

  const handleClassificationConfirm = useCallback(async () => {
    if (!classificationDialog) return
    const { vector, draft } = classificationDialog
    try {
      await window.api.updateVector(vector.id, {
        antibiotic_resistance: draft.antibiotic_resistance, host_type: draft.host_type,
        promoters: draft.promoters, promoter_type: draft.promoter_type as any,
        purpose: draft.purpose, reporter_gene: draft.reporter_gene, is_recombinant: draft.is_recombinant
      })
      log.info(`Smart annotation: updated vector ${vector.id} classification`); loadVectors()
      if (selectedVector?.id === vector.id) { const updated = vectors.find(v => v.id === vector.id); if (updated) setSelectedVector(updated) }
    } catch (e: any) { alert(`更新分类信息失败: ${e.message || e}`) }
    finally { setClassificationDialog(null); setAnnotatingId(null); setNormalizationVector(null) }
  }, [classificationDialog, selectedVector, vectors])

  const filtered = vectors.filter(v => !searchQuery || v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (v.description || '').toLowerCase().includes(searchQuery.toLowerCase()) || (v.antibiotic_resistance || '').toLowerCase().includes(searchQuery.toLowerCase()))

  // 显示辅助
  const fmtHosts = (h: string | undefined) => parseJsonArray(h).join(', ') || '-'
  const fmtPromoters = (p: string | undefined) => { const arr = parseJsonArray(p); return arr.length > 0 ? arr.join(', ') : '-' }

  return (
    <div className="flex gap-6 h-full">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <div className="flex-1 relative min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="搜索载体名称、描述、抗性..." value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <button onClick={handleImport} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-500 flex items-center gap-1"><Upload size={16} /> 导入文件</button>
          <button onClick={handleCreate} className="px-3 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-500 flex items-center gap-1"><Plus size={16} /> 手动添加</button>
          {!exportMode ? (
            <button onClick={() => setExportMode(true)} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-500 flex items-center gap-1"><Download size={16} /> 导出</button>
          ) : (
            <div className="flex items-center gap-2">
              <select value={exportFormat} onChange={e => setExportFormat(e.target.value as any)} className="px-2 py-2 border border-slate-200 rounded-lg text-sm">
                <option value="genbank">GenBank (.gb)</option><option value="fasta">FASTA (.fasta)</option><option value="dna">DNA Binary (.dna)</option>
              </select>
              <button onClick={handleBatchExport} disabled={selectedIds.size === 0 || exportLoading}
                className={`px-3 py-2 rounded-lg text-sm flex items-center gap-1 ${selectedIds.size > 0 ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                <Download size={16} /> {exportLoading ? '导出中...' : `导出选中(${selectedIds.size})`}
              </button>
              <button onClick={cancelExport} className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">取消</button>
            </div>
          )}
        </div>

        {importMsg && <div className="mb-3 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-sm flex items-center gap-2"><FileText size={14} /> {importMsg}</div>}

        {/* Table */}
        <div className="flex-1 overflow-auto bg-white rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr>
                {exportMode && <th className="text-center px-2 py-2 w-8"><input type="checkbox" className="accent-blue-600" checked={filtered.length > 0 && selectedIds.size === filtered.length} onChange={toggleSelectAll} /></th>}
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">名称</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">类型</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">总长(bp)</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">目的</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">宿主</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">启动子</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">抗性</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">报告基因</th>
                <th className="text-center px-3 py-2 font-medium text-slate-600 whitespace-nowrap">图谱</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600 whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => {
                const isAnnotating = annotatingId === v.id; const hasSequence = !!v.sequence
                return (
                  <tr key={v.id} onClick={() => exportMode ? toggleSelectId(v.id) : setSelectedVector(v)}
                    className={`border-t border-slate-100 cursor-pointer transition-colors ${exportMode && selectedIds.has(v.id) ? 'bg-blue-50' : selectedVector?.id === v.id ? 'bg-violet-50' : 'hover:bg-slate-50'}`}>
                    {exportMode && <td className="text-center px-2 py-2 w-8" onClick={e => e.stopPropagation()}><input type="checkbox" className="accent-blue-600" checked={selectedIds.has(v.id)} onChange={() => toggleSelectId(v.id)} /></td>}
                    <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{v.name}</td>
                    <td className="px-3 py-2"><span className="px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded text-xs">{typeLabels[v.type] || v.type}</span></td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{v.size_bp?.toLocaleString() || 0}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-[120px] truncate">{v.purpose || '-'}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-[100px] truncate">{fmtHosts(v.host_type)}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-[120px] truncate">{fmtPromoters(v.promoters)}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{v.antibiotic_resistance || '-'}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-[100px] truncate">{v.reporter_gene || '-'}</td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={e => { e.stopPropagation(); window.api.openEditor(v.id) }}
                          className="px-2 py-1 text-xs text-violet-600 border border-violet-200 rounded flex items-center gap-1 hover:bg-violet-50" title="打开图谱编辑器">
                          <Map size={12} /> 图谱</button>
                        <button onClick={e => { e.stopPropagation(); handleSmartAnnotate(v) }} disabled={isAnnotating || !hasSequence}
                          className={`px-2 py-1 text-xs border rounded flex items-center gap-1 transition-colors ${!hasSequence ? 'text-slate-300 border-slate-100 cursor-not-allowed' : isAnnotating ? 'text-emerald-500 border-emerald-200 bg-emerald-50' : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50'}`}
                          title={hasSequence ? '智能标注' : '无序列数据'}>
                          {isAnnotating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}{isAnnotating ? (smartAnnotation.progress ? `识别中 ${Math.round(smartAnnotation.progress.percent)}%` : '识别中') : '标注'}
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={e => { e.stopPropagation(); handleEdit(v) }} className="p-1 text-slate-400 hover:text-blue-600"><Edit2 size={14} /></button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(v.id) }} className="p-1 text-slate-400 hover:text-red-600 ml-1"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="text-center py-12 text-slate-400">暂无数据，点击"导入文件"或"手动添加"创建载体</div>}
        </div>
        <div className="text-xs text-slate-400 mt-2">共 {filtered.length} 条记录</div>
      </div>

      {/* Detail Panel */}
      {selectedVector && (
        <div className="w-80 bg-white rounded-lg border border-slate-200 p-5 flex-shrink-0 overflow-auto">
          <div className="flex items-center justify-between mb-4">
            {detailEditing ? (
              <input value={detailForm.name} onChange={e => setDetailForm(f => ({ ...f, name: e.target.value }))}
                className="text-lg font-bold text-slate-800 border-b border-violet-300 outline-none bg-transparent flex-1 mr-2" />
            ) : (
              <h3 className="text-lg font-bold text-slate-800">{selectedVector.name}</h3>
            )}
            <div className="flex items-center gap-1 flex-shrink-0">
              {detailEditing ? (
                <>
                  <button onClick={handleDetailSave} className="px-2 py-1 bg-emerald-600 text-white rounded text-xs flex items-center gap-1 hover:bg-emerald-500"><Check size={12} /> 保存</button>
                  <button onClick={() => { setDetailEditing(false); if (selectedVector) setDetailForm({ name: selectedVector.name, type: selectedVector.type, size_bp: selectedVector.size_bp, description: selectedVector.description || '', topology: selectedVector.topology || 'circular', purpose: selectedVector.purpose || '', host_type: selectedVector.host_type || '[]', promoter_type: selectedVector.promoter_type || 'none', promoters: selectedVector.promoters || '[]', reporter_gene: selectedVector.reporter_gene || '', is_recombinant: !!selectedVector.is_recombinant, antibiotic_resistance: selectedVector.antibiotic_resistance || '', copy_number: selectedVector.copy_number || '' }) }} className="px-2 py-1 text-slate-500 border rounded text-xs hover:bg-slate-50">取消</button>
                </>
              ) : (
                <>
                  <button onClick={() => setDetailEditing(true)} className="px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded flex items-center gap-1 hover:bg-blue-50"><Edit2 size={12} /> 编辑</button>
                  <button onClick={() => window.api.openEditor(selectedVector.id)} className="px-2 py-1 bg-violet-600 text-white rounded text-xs flex items-center gap-1 hover:bg-violet-500"><Map size={12} /> 图谱</button>
                  {selectedVector.sequence && <button onClick={() => setShowDigestPanel(true)} className="px-2 py-1 bg-rose-600 text-white rounded text-xs flex items-center gap-1 hover:bg-rose-500"><Beaker size={12} /> 酶切</button>}
                  <button onClick={() => setSelectedVector(null)} className="p-1 text-slate-400 hover:text-slate-600"><X size={16} /></button>
                </>
              )}
            </div>
          </div>
          <div className="space-y-3 text-sm">
            {detailEditing ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] font-medium text-slate-500">载体类型</label>
                    <select value={detailForm.type} onChange={e => setDetailForm(f => ({ ...f, type: e.target.value as VectorType }))}
                      className="w-full mt-0.5 px-2 py-1 text-xs border rounded">{Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  <div><label className="text-[10px] font-medium text-slate-500">拓扑结构</label>
                    <select value={detailForm.topology} onChange={e => setDetailForm(f => ({ ...f, topology: e.target.value }))}
                      className="w-full mt-0.5 px-2 py-1 text-xs border rounded">{Object.entries(topologyLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                </div>
                <div><label className="text-[10px] font-medium text-slate-500">序列总长 (bp)</label>
                  <input type="number" value={detailForm.size_bp} onChange={e => setDetailForm(f => ({ ...f, size_bp: parseInt(e.target.value) || 0 }))}
                    className="w-full mt-0.5 px-2 py-1 text-xs border rounded" /></div>
                <div><label className="text-[10px] font-medium text-slate-500">基因工程目的</label>
                  <input value={detailForm.purpose} onChange={e => setDetailForm(f => ({ ...f, purpose: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1 text-xs border rounded" /></div>
                <div><label className="text-[10px] font-medium text-slate-500">宿主类型（多值）</label>
                  <TagInput values={parseJsonArray(detailForm.host_type)}
                    onChange={v => setDetailForm(f => ({ ...f, host_type: toJsonArray(v) }))}
                    placeholder="添加宿主..." suggestions={['大肠杆菌', '哺乳动物', '酵母', '植物', '昆虫', '农杆菌', '芽孢杆菌']} /></div>
                <div><label className="text-[10px] font-medium text-slate-500">启动子（多值）</label>
                  <TagInput values={parseJsonArray(detailForm.promoters)}
                    onChange={v => setDetailForm(f => ({ ...f, promoters: toJsonArray(v) }))}
                    placeholder="添加启动子..." /></div>
                <div><label className="text-[10px] font-medium text-slate-500">报告基因</label>
                  <input value={detailForm.reporter_gene} onChange={e => setDetailForm(f => ({ ...f, reporter_gene: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1 text-xs border rounded" placeholder="如 GFP, mCherry" /></div>
                <div><label className="text-[10px] font-medium text-slate-500">抗生素抗性</label>
                  <TagInput values={detailForm.antibiotic_resistance ? detailForm.antibiotic_resistance.split(', ').filter(Boolean) : []}
                    onChange={v => setDetailForm(f => ({ ...f, antibiotic_resistance: v.join(', ') }))}
                    placeholder="添加抗性..." suggestions={COMMON_RESISTANCE} /></div>
                <div><label className="text-[10px] font-medium text-slate-500">拷贝数</label>
                  <input value={detailForm.copy_number} onChange={e => setDetailForm(f => ({ ...f, copy_number: e.target.value }))}
                    className="w-full mt-0.5 px-2 py-1 text-xs border rounded" /></div>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={detailForm.is_recombinant}
                  onChange={e => setDetailForm(f => ({ ...f, is_recombinant: e.target.checked }))} className="rounded" />重组质粒</label>
                <div><label className="text-[10px] font-medium text-slate-500">描述</label>
                  <textarea value={detailForm.description} onChange={e => setDetailForm(f => ({ ...f, description: e.target.value }))} rows={2}
                    className="w-full mt-0.5 px-2 py-1 text-xs border rounded" /></div>
              </>
            ) : (
              <>
                <DetailRow label="类型" value={typeLabels[selectedVector.type] || selectedVector.type} />
                <DetailRow label="拓扑结构" value={topologyLabels[selectedVector.topology] || selectedVector.topology || '-'} />
                <DetailRow label="序列总长" value={`${(selectedVector.size_bp || 0).toLocaleString()} bp`} />
                <DetailRow label="基因工程目的" value={selectedVector.purpose || '-'} />
                <DetailRow label="宿主类型" value={fmtHosts(selectedVector.host_type)} />
                <DetailRow label="启动子" value={fmtPromoters(selectedVector.promoters)} />
                <DetailRow label="报告基因" value={selectedVector.reporter_gene || '-'} />
                <DetailRow label="重组质粒" value={selectedVector.is_recombinant ? '是' : '否'} />
                <DetailRow label="抗生素抗性" value={selectedVector.antibiotic_resistance || '未指定'} />
                <DetailRow label="拷贝数" value={selectedVector.copy_number || '未指定'} />
                <DetailRow label="描述" value={selectedVector.description || '无'} />
              </>
            )}
            {selectedVector.source_file && <DetailRow label="来源文件" value={selectedVector.source_file} />}
            {selectedVector.backbone_id && <div><label className="text-xs font-medium text-slate-500 uppercase">空载体</label><p className="mt-1 flex items-center gap-1 text-blue-600"><Link2 size={12} /> 已关联空载体</p></div>}
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase">酶切位点</label>
              <div className="mt-1 space-y-1">
                {enzymeSites.length > 0 ? enzymeSites.map((site: any) => (
                  <div key={site.id} className="flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1">
                    <span className="font-medium">{site.enzyme_name}</span><span className="text-slate-500">{site.position} bp</span>
                    {site.is_unique ? <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">唯一</span> : <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded">多位点</span>}
                  </div>
                )) : <p className="text-xs text-slate-400">暂无酶切位点数据</p>}
              </div>
            </div>
            {selectedVector.sequence && <div><label className="text-xs font-medium text-slate-500 uppercase">序列预览</label>
              <div className="mt-1 bg-slate-50 rounded p-2 sequence-display text-xs max-h-24 overflow-auto">{selectedVector.sequence.substring(0, 300)}{selectedVector.sequence.length > 300 ? '...' : ''}</div></div>}
          </div>
        </div>
      )}

      {/* 模拟酶切鉴定面板 */}
      {showDigestPanel && selectedVector?.sequence && (
        <div className="fixed inset-y-0 right-0 w-[900px] bg-white shadow-2xl border-l border-slate-200 z-[9998] flex flex-col overflow-hidden">
          <DigestSimulationPanel sequence={selectedVector.sequence} topology={(selectedVector.topology as 'circular' | 'linear') || 'circular'} onClose={() => setShowDigestPanel(false)} className="flex-1" />
        </div>
      )}

      {/* 智能标注弹窗 */}
      {smartAnnotation.matches && smartAnnotation.matches.length > 0 && normalizationVector && (
        <NormalizationDialog matches={smartAnnotation.matches} vectorName={normalizationVector.name} onAccept={handleNormalizationAccept}
          onClose={() => { smartAnnotation.reset(); setNormalizationVector(null); setAnnotatingId(null) }} />
      )}

      {/* 分类推断确认弹窗 */}
      {classificationDialog && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/40" onClick={() => { setClassificationDialog(null); setAnnotatingId(null); setNormalizationVector(null) }}>
          <div className="bg-white rounded-xl shadow-2xl w-[540px] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2"><Sparkles size={16} className="text-violet-500" /><h3 className="text-sm font-bold text-slate-800">载体分类推断</h3></div>
              <button onClick={() => { setClassificationDialog(null); setAnnotatingId(null); setNormalizationVector(null) }} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <p className="text-xs text-slate-500 mb-3">根据已确认的元件标注，自动推断载体 <span className="font-bold text-slate-700">{classificationDialog.vector.name}</span> 的分类信息。请检查并修改后确认：</p>

              {/* 抗生素抗性 */}
              <div>
                <label className="text-[10px] font-medium text-slate-500 flex items-center gap-1"><AlertCircle size={10} className="text-amber-400" /> 抗生素抗性</label>
                <div className="mt-1">
                  <TagInput values={classificationDialog.draft.antibiotic_resistance ? classificationDialog.draft.antibiotic_resistance.split(', ').filter(Boolean) : []}
                    onChange={v => setClassificationDialog({ ...classificationDialog, draft: { ...classificationDialog.draft, antibiotic_resistance: v.join(', ') } })}
                    placeholder="添加抗性..." suggestions={COMMON_RESISTANCE} />
                </div>
              </div>

              {/* 宿主类型（多值标签） */}
              <div>
                <label className="text-[10px] font-medium text-slate-500">宿主类型（多值）</label>
                <div className="mt-1">
                  <TagInput values={parseJsonArray(classificationDialog.draft.host_type)}
                    onChange={v => setClassificationDialog({ ...classificationDialog, draft: { ...classificationDialog.draft, host_type: toJsonArray(v) } })}
                    placeholder="添加宿主..." suggestions={['大肠杆菌', '哺乳动物', '酵母', '植物', '昆虫', '农杆菌', '芽孢杆菌']} />
                </div>
              </div>

              {/* 启动子（多值标签） */}
              <div>
                <label className="text-[10px] font-medium text-slate-500">启动子（多值）</label>
                <div className="mt-1">
                  <TagInput values={parseJsonArray(classificationDialog.draft.promoters)}
                    onChange={v => setClassificationDialog({ ...classificationDialog, draft: { ...classificationDialog.draft, promoters: toJsonArray(v) } })}
                    placeholder="添加启动子..." />
                </div>
              </div>

              {/* 目的（自由文本） */}
              <div>
                <label className="text-[10px] font-medium text-slate-500">基因工程目的</label>
                <input value={classificationDialog.draft.purpose} list="purpose-suggestions"
                  onChange={e => setClassificationDialog({ ...classificationDialog, draft: { ...classificationDialog.draft, purpose: e.target.value } })}
                  className="w-full mt-1 px-2 py-1.5 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-violet-400" />
                <datalist id="purpose-suggestions">{purposeOptions.map(p => <option key={p} value={p} />)}</datalist>
              </div>

              {/* 报告基因 */}
              <div>
                <label className="text-[10px] font-medium text-slate-500">报告基因</label>
                <input value={classificationDialog.draft.reporter_gene}
                  onChange={e => setClassificationDialog({ ...classificationDialog, draft: { ...classificationDialog.draft, reporter_gene: e.target.value } })}
                  placeholder="如 GFP, mCherry" className="w-full mt-1 px-2 py-1.5 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-violet-400" />
              </div>

              {/* 重组质粒 */}
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={classificationDialog.draft.is_recombinant}
                  onChange={e => setClassificationDialog({ ...classificationDialog, draft: { ...classificationDialog.draft, is_recombinant: e.target.checked } })}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-violet-600" />重组质粒
              </label>

              {/* 元件方向折叠区 */}
              {classificationDialog.draft.directions.length > 0 && (
                <div>
                  <button onClick={() => setShowDirections(!showDirections)} className="flex items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-slate-700">
                    {showDirections ? <ChevronDown size={12} /> : <ChevronRight size={12} />}元件方向 ({classificationDialog.draft.directions.length})
                  </button>
                  {showDirections && (
                    <div className="mt-1 max-h-32 overflow-auto space-y-0.5">
                      {classificationDialog.draft.directions.map((d, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px] px-2 py-0.5 bg-slate-50 rounded">
                          <span className="flex-1 truncate">{d.name}</span>
                          <span className={`px-1 rounded ${d.strand === 1 ? 'text-blue-600 bg-blue-50' : 'text-orange-600 bg-orange-50'}`}>{d.strand === 1 ? '正义 (+)' : '反义 (−)'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 变更摘要 */}
              <div className="mt-2 p-2 bg-violet-50 rounded-lg border border-violet-100">
                <p className="text-[10px] text-violet-600 font-medium mb-1">变更摘要</p>
                <div className="space-y-0.5 text-[10px]">
                  {classificationDialog.vector.antibiotic_resistance !== classificationDialog.draft.antibiotic_resistance && (
                    <div className="text-slate-600">抗性: {classificationDialog.vector.antibiotic_resistance || '(空)'} → <span className="text-violet-700 font-medium">{classificationDialog.draft.antibiotic_resistance || '(空)'}</span></div>)}
                  {(classificationDialog.vector.host_type || '[]') !== classificationDialog.draft.host_type && (
                    <div className="text-slate-600">宿主: {fmtHosts(classificationDialog.vector.host_type)} → <span className="text-violet-700 font-medium">{fmtHosts(classificationDialog.draft.host_type)}</span></div>)}
                  {(classificationDialog.vector.promoters || '[]') !== classificationDialog.draft.promoters && (
                    <div className="text-slate-600">启动子: {fmtPromoters(classificationDialog.vector.promoters)} → <span className="text-violet-700 font-medium">{fmtPromoters(classificationDialog.draft.promoters)}</span></div>)}
                  {(classificationDialog.vector.purpose || '') !== classificationDialog.draft.purpose && (
                    <div className="text-slate-600">目的: {classificationDialog.vector.purpose || '(空)'} → <span className="text-violet-700 font-medium">{classificationDialog.draft.purpose || '(空)'}</span></div>)}
                  {(classificationDialog.vector.reporter_gene || '') !== classificationDialog.draft.reporter_gene && (
                    <div className="text-slate-600">报告基因: {classificationDialog.vector.reporter_gene || '(空)'} → <span className="text-violet-700 font-medium">{classificationDialog.draft.reporter_gene || '(空)'}</span></div>)}
                  {!!classificationDialog.vector.is_recombinant !== classificationDialog.draft.is_recombinant && (
                    <div className="text-slate-600">重组: {classificationDialog.vector.is_recombinant ? '是' : '否'} → <span className="text-violet-700 font-medium">{classificationDialog.draft.is_recombinant ? '是' : '否'}</span></div>)}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl">
              <span className="text-[10px] text-slate-400">载体: {classificationDialog.vector.name}</span>
              <div className="flex gap-2">
                <button onClick={() => { setClassificationDialog(null); setAnnotatingId(null); setNormalizationVector(null) }} className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded hover:bg-slate-100">取消</button>
                <button onClick={handleClassificationConfirm} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-violet-600 text-white rounded hover:bg-violet-500"><Check size={12} /> 应用分类</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[580px] max-h-[85vh] overflow-auto shadow-xl">
            <h3 className="text-lg font-bold mb-4">{editingVector ? '编辑载体' : '添加载体'}</h3>
            <div className="space-y-3">
              <div><label className="text-sm font-medium text-slate-600">名称 *</label>
                <input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-slate-600">载体类型</label>
                  <select value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value as VectorType })} className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                    {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
                <div><label className="text-sm font-medium text-slate-600">拓扑结构</label>
                  <select value={formData.topology} onChange={e => setFormData({ ...formData, topology: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                    {Object.entries(topologyLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
              </div>
              <div><label className="text-sm font-medium text-slate-600">基因工程目的</label>
                <input value={formData.purpose} list="form-purpose-suggestions" onChange={e => setFormData({ ...formData, purpose: e.target.value })} placeholder="如：荧光蛋白表达、CRISPR"
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                <datalist id="form-purpose-suggestions">{purposeOptions.map(p => <option key={p} value={p} />)}</datalist>
              </div>
              <div><label className="text-sm font-medium text-slate-600">宿主类型（多值）</label>
                <div className="mt-1"><TagInput values={parseJsonArray(formData.host_type)}
                  onChange={v => setFormData({ ...formData, host_type: toJsonArray(v) })}
                  placeholder="添加宿主..." suggestions={['大肠杆菌', '哺乳动物', '酵母', '植物', '昆虫', '农杆菌', '芽孢杆菌']} /></div></div>
              <div><label className="text-sm font-medium text-slate-600">启动子（多值）</label>
                <div className="mt-1"><TagInput values={parseJsonArray(formData.promoters)}
                  onChange={v => setFormData({ ...formData, promoters: toJsonArray(v) })}
                  placeholder="如：大肠杆菌 T7, 人 CMV" /></div></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-slate-600">报告基因</label>
                  <input value={formData.reporter_gene} onChange={e => setFormData({ ...formData, reporter_gene: e.target.value })} placeholder="如: GFP, mCherry"
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" /></div>
                <div><label className="text-sm font-medium text-slate-600">序列总长 (bp)</label>
                  <input type="number" value={formData.size_bp} onChange={e => setFormData({ ...formData, size_bp: parseInt(e.target.value) || 0 })}
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-slate-600">抗生素抗性</label>
                  <div className="mt-1"><TagInput values={formData.antibiotic_resistance ? formData.antibiotic_resistance.split(', ').filter(Boolean) : []}
                    onChange={v => setFormData({ ...formData, antibiotic_resistance: v.join(', ') })}
                    placeholder="添加抗性..." suggestions={COMMON_RESISTANCE} /></div></div>
                <div><label className="text-sm font-medium text-slate-600">拷贝数</label>
                  <input value={formData.copy_number} onChange={e => setFormData({ ...formData, copy_number: e.target.value })} placeholder="如: High copy, Low copy"
                    className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" /></div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={formData.is_recombinant} onChange={e => setFormData({ ...formData, is_recombinant: e.target.checked })} className="rounded" />重组质粒
              </label>
              <div><label className="text-sm font-medium text-slate-600">描述</label>
                <textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={2}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" /></div>
              <div><label className="text-sm font-medium text-slate-600">序列</label>
                <textarea value={formData.sequence} onChange={e => setFormData({ ...formData, sequence: e.target.value })} rows={3}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500" /></div>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 border rounded-lg hover:bg-slate-50">取消</button>
              <button onClick={handleSubmit} className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-500">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (<div><label className="text-xs font-medium text-slate-500 uppercase">{label}</label><p className="mt-0.5 text-slate-700">{value}</p></div>)
}
