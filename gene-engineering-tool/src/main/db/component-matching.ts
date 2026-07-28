/**
 * @module db/component-matching
 * @description
 * 元件匹配算法 Service — 提供载体序列的元件扫描、智能标注和单序列识别。
 *
 * 架构设计意图：
 * - 将纯计算逻辑（序列比对/匹配）与数据库 CRUD 分离
 * - 本模块职责：输入序列 → 输出匹配结果（算法层）
 * - component-repo 职责：数据库持久化（数据层）
 * - 两者职责正交，可独立测试和维护
 *
 * 核心算法：
 * 1. scanVectorForComponents: 三类比对（DNA→DNA、AA→DNA、DNA→AA）扫描载体中的已知元件
 * 2. smartAnnotateComponents: 对载体 features 做全局序列比对 + 名称回退匹配
 * 3. identifyFeatureSequence: 对单个序列在元件库中做滑动窗口匹配
 *
 * 匹配策略：
 * - DNA→DNA: 精确匹配 → 部分匹配（≤10% 错配）→ 反向互补
 * - AA→DNA: 六框翻译后蛋白级比对（matchAminoToDna）
 * - DNA→AA: 蛋白变体与载体 DNA 六框翻译比对
 * - 名称回退: 精确匹配 → 子串匹配 → 抗性基因关键词映射 → 类型关键词映射
 *
 * 依赖关系：
 * - db/base: 底层查询工具 + reverseComplement + CODON_TABLE
 * - componentMatch: matchAminoToDna, matchDnaToAA, isValidDna, isValidProtein, slidingWindowMatch
 * - shared/types: GenBankFeature, VectorComponent, ComponentMatch, SmartMatchResult 等
 */

import type { VectorComponent, VectorComponentType, ComponentVariant, ComponentMatch, GenBankFeature, SmartMatchResult, SmartMatchCandidate } from '../../shared/types'
import { queryAll, queryOne, getDb, reverseComplement, CODON_TABLE } from './base'
import { matchAminoToDna, matchDnaToAA, isValidDna, isValidProtein, slidingWindowMatch, sixFrameTranslation } from '../componentMatch'

// ============ 载体序列元件扫描 ============

/** 构建用于 UI 展示的精简元数据 */
function buildComponentMetadata(c: VectorComponent): Partial<VectorComponent> {
  return {
    feature_id: c.feature_id,
    direction: c.direction,
    species: c.species,
    species_short: c.species_short,
    species_latin: c.species_latin,
    species_cn: c.species_cn,
    taxonomic_category: c.taxonomic_category,
    product_description: c.product_description,
    gene: c.gene,
    bound_moiety: c.bound_moiety,
    source_databases: c.source_databases,
    total_occurrences: c.total_occurrences,
    annotation_method: c.annotation_method,
    molecular_weight: c.molecular_weight,
    ref_protein_sequence: c.ref_protein_sequence
  }
}

/** 查找指定位置范围内的 feature 名称 */
function findFeatureNameAtPosition(features: GenBankFeature[], start: number, end: number): string {
  if (!features || features.length === 0) return ''
  let bestFeature: GenBankFeature | null = null
  let bestOverlap = 0
  for (const f of features) {
    const fStart = f.start + 1
    const fEnd = f.end
    const overlapStart = Math.max(start, fStart)
    const overlapEnd = Math.min(end, fEnd)
    const overlap = Math.max(0, overlapEnd - overlapStart + 1)
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestFeature = f
    }
  }
  if (bestFeature) {
    return bestFeature.qualifiers?.label || bestFeature.qualifiers?.gene || bestFeature.qualifiers?.product || bestFeature.type
  }
  return ''
}

/** 扫描载体序列，返回与元件数据库匹配的所有元件
 *  支持三类比对：DNA→DNA、AA→DNA、DNA→AA */
export function scanVectorForComponents(vectorSeq: string, features: GenBankFeature[] = []): ComponentMatch[] {
  if (!vectorSeq) return []
  const seq = vectorSeq.toUpperCase().replace(/[^ATGC]/g, '')
  if (seq.length < 10) return []

  const components = queryAll<VectorComponent>('SELECT * FROM vector_components WHERE sequence IS NOT NULL AND sequence != \'\'')
  const variants = queryAll<ComponentVariant>('SELECT * FROM component_variants')
  const variantsByComponent = new Map<number, ComponentVariant[]>()
  for (const v of variants) {
    const cid = v.component_id ?? 0
    if (!variantsByComponent.has(cid)) variantsByComponent.set(cid, [])
    variantsByComponent.get(cid)!.push(v)
  }

  const matches: ComponentMatch[] = []

  for (const dbComp of components) {
    const rawCompSeq = (dbComp.sequence || '').replace(/\s/g, '')
    const compSeq = rawCompSeq.toUpperCase().replace(/[^ATGC]/g, '')
    const hasValidDna = isValidDna(rawCompSeq) && compSeq.length >= 10

    let rawAaSource = (dbComp.amino_acid_sequence || dbComp.ref_protein_sequence || '')
    if (!rawAaSource && !hasValidDna && isValidProtein(rawCompSeq)) {
      rawAaSource = rawCompSeq
    }
    const aaSeq = rawAaSource.toUpperCase().replace(/[^A-Z\*]/g, '')
    const hasValidAa = isValidProtein(rawAaSource) && aaSeq.length >= 5

    const metadata = buildComponentMetadata(dbComp)

    // 1. DNA → DNA：完全匹配和部分匹配（优先）
    if (hasValidDna) {
      let pos = seq.indexOf(compSeq)
      if (pos >= 0) {
        const currentName = findFeatureNameAtPosition(features, pos + 1, pos + compSeq.length)
        matches.push({
          component_id: dbComp.id, standard_name: dbComp.standard_name, current_name: currentName,
          match_type: 'exact', identity: 100, match_start: pos + 1, match_end: pos + compSeq.length,
          strand: 1, component_type: dbComp.type, metadata
        })
        continue
      }
      const rc = reverseComplement(compSeq)
      pos = seq.indexOf(rc)
      if (pos >= 0) {
        const currentName = findFeatureNameAtPosition(features, pos + 1, pos + rc.length)
        matches.push({
          component_id: dbComp.id, standard_name: dbComp.standard_name, current_name: currentName,
          match_type: 'exact', identity: 100, match_start: pos + 1, match_end: pos + rc.length,
          strand: -1, component_type: dbComp.type, metadata
        })
        continue
      }

      // 部分匹配
      const windowSize = compSeq.length
      const maxMismatches = Math.floor(windowSize * 0.1)
      if (seq.length >= windowSize) {
        let bestMatch = { mismatches: maxMismatches + 1, pos: -1 }
        for (let i = 0; i <= seq.length - windowSize; i++) {
          let mismatches = 0
          for (let j = 0; j < windowSize; j++) {
            if (seq[i + j] !== compSeq[j]) { mismatches++; if (mismatches > maxMismatches) break }
          }
          if (mismatches <= maxMismatches && mismatches < bestMatch.mismatches) {
            bestMatch = { mismatches, pos: i }
            if (mismatches === 0) break
          }
        }
        if (bestMatch.pos >= 0) {
          const identity = Math.round(((windowSize - bestMatch.mismatches) / windowSize) * 100)
          const currentName = findFeatureNameAtPosition(features, bestMatch.pos + 1, bestMatch.pos + windowSize)
          matches.push({
            component_id: dbComp.id, standard_name: dbComp.standard_name, current_name: currentName,
            match_type: bestMatch.mismatches === 0 ? 'exact' : 'partial', identity,
            match_start: bestMatch.pos + 1, match_end: bestMatch.pos + windowSize,
            strand: 1, component_type: dbComp.type, metadata
          })
          continue
        }
        // 反向互补部分匹配
        bestMatch = { mismatches: maxMismatches + 1, pos: -1 }
        for (let i = 0; i <= seq.length - windowSize; i++) {
          let mismatches = 0
          for (let j = 0; j < windowSize; j++) {
            if (seq[i + j] !== rc[j]) { mismatches++; if (mismatches > maxMismatches) break }
          }
          if (mismatches <= maxMismatches && mismatches < bestMatch.mismatches) {
            bestMatch = { mismatches, pos: i }
            if (mismatches === 0) break
          }
        }
        if (bestMatch.pos >= 0) {
          const identity = Math.round(((windowSize - bestMatch.mismatches) / windowSize) * 100)
          const currentName = findFeatureNameAtPosition(features, bestMatch.pos + 1, bestMatch.pos + windowSize)
          matches.push({
            component_id: dbComp.id, standard_name: dbComp.standard_name, current_name: currentName,
            match_type: bestMatch.mismatches === 0 ? 'exact' : 'partial', identity,
            match_start: bestMatch.pos + 1, match_end: bestMatch.pos + windowSize,
            strand: -1, component_type: dbComp.type, metadata
          })
          continue
        }
      }
    }

    // 2. AA → DNA：用蛋白序列在载体 DNA 六框翻译中搜索
    if (hasValidAa) {
      const aaMatch = matchAminoToDna(aaSeq, seq, 80)
      if (aaMatch) {
        const currentName = findFeatureNameAtPosition(features, aaMatch.start, aaMatch.end)
        matches.push({
          component_id: dbComp.id, standard_name: dbComp.standard_name, current_name: currentName,
          match_type: aaMatch.matchType, identity: aaMatch.identity,
          match_start: aaMatch.start, match_end: aaMatch.end,
          strand: aaMatch.strand, component_type: dbComp.type, metadata
        })
        continue
      }
    }

    // 3. DNA → AA：对无 DNA 但有 Protein 变体的组件，将载体 DNA 六框翻译后与蛋白变体比对
    if (!hasValidDna) {
      const proteinVariants = variantsByComponent.get(dbComp.id)?.filter(v => v.seq_type === 'Protein' && isValidProtein(v.sequence)) || []
      if (proteinVariants.length > 0) {
        for (const pv of proteinVariants) {
          const pvSeq = pv.sequence.toUpperCase().replace(/[^A-Z\*]/g, '')
          const aaMatch = matchAminoToDna(pvSeq, seq, 80)
          if (aaMatch) {
            const currentName = findFeatureNameAtPosition(features, aaMatch.start, aaMatch.end)
            matches.push({
              component_id: dbComp.id, standard_name: dbComp.standard_name, current_name: currentName,
              match_type: aaMatch.matchType, identity: aaMatch.identity,
              match_start: aaMatch.start, match_end: aaMatch.end,
              strand: aaMatch.strand, component_type: dbComp.type, metadata
            })
            break
          }
        }
      }
    }
  }

  return matches
}

// ============ 智能标注元件 ============

/** 有界 Levenshtein 编辑距离（超出 maxEdits 提前返回 -1） */
function boundedEditDistance(a: string, b: string, maxEdits: number): number {
  const n = a.length, m = b.length
  if (Math.abs(n - m) > maxEdits) return -1
  if (n === 0) return m
  if (m === 0) return n
  let s1 = a, s2 = b
  if (n < m) { s1 = b; s2 = a }
  const len1 = s1.length, len2 = s2.length
  let prev = new Int32Array(len2 + 1)
  let curr = new Int32Array(len2 + 1)
  for (let j = 0; j <= len2; j++) prev[j] = j
  for (let i = 1; i <= len1; i++) {
    curr[0] = i
    const c1 = s1[i - 1]
    const rowMin = Math.max(0, i - maxEdits)
    const rowMax = Math.min(len2, i + maxEdits)
    if (rowMin > 0) curr[rowMin - 1] = maxEdits + 1
    let minInRow = maxEdits + 1
    for (let j = Math.max(1, rowMin); j <= rowMax; j++) {
      const cost = c1 === s2[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      if (curr[j] < minInRow) minInRow = curr[j]
    }
    if (minInRow > maxEdits) return -1
    const tmp = prev; prev = curr; curr = tmp
  }
  return prev[len2] <= maxEdits ? prev[len2] : -1
}

/** 计算两条序列的相似度百分比（超出阈值返回 0） */
function calcSeqSimilarity(a: string, b: string, threshold: number): number {
  if (!a || !b) return 0
  if (a === b) return 100
  const maxLen = Math.max(a.length, b.length)
  const minLen = Math.min(a.length, b.length)
  const maxLenDiff = Math.ceil(maxLen * (1 - threshold / 100))
  if (maxLen - minLen > maxLenDiff) return 0
  const maxEdits = Math.ceil(maxLen * (1 - threshold / 100))
  const dist = boundedEditDistance(a, b, maxEdits)
  if (dist < 0) return 0
  return Math.round((1 - dist / maxLen) * 10000) / 100
}

/** 从载体序列中提取 feature 的 DNA 序列（支持环形跨越原点） */
function extractFeatDNA(vectorSeq: string, feature: GenBankFeature): string {
  if (!vectorSeq || feature.start < 0 || feature.end <= 0) return ''
  const seqLen = vectorSeq.length
  if (feature.start < feature.end) {
    return vectorSeq.substring(feature.start, feature.end)
  }
  return vectorSeq.substring(feature.start, seqLen) + vectorSeq.substring(0, feature.end)
}

/** 将 DNA 按 3 个正向阅读框翻译为蛋白序列 */
function translateAllFrames(dnaSeq: string): string[] {
  const seq = dnaSeq.toUpperCase().replace(/[^ATGC]/g, '')
  const results: string[] = []
  for (let frame = 0; frame < 3; frame++) {
    let aa = ''
    for (let i = frame; i + 2 < seq.length; i += 3) {
      const codon = seq.substring(i, i + 3)
      const c = CODON_TABLE[codon]
      if (!c) break
      aa += c // 保留终止密码子为 *，确保 sw.pos 正确映射到密码子索引
    }
    results.push(aa)
  }
  return results
}

/** 计算 AA 字符串中 matchPos 之前的终止密码子数量 */
function countStopsBefore(aaSeq: string, matchPos: number): number {
  let count = 0
  for (let i = 0; i < matchPos && i < aaSeq.length; i++) {
    if (aaSeq[i] === '*') count++
  }
  return count
}

/** 滑动窗口局部相似度 */
function slidingWindowSimilarity(needle: string, haystack: string, threshold: number): number {
  if (!needle || !haystack || needle.length < 10 || haystack.length < needle.length) return 0
  const maxMismatches = Math.floor(needle.length * (1 - threshold / 100))
  const result = slidingWindowMatch(haystack, needle, maxMismatches)
  if (result && result.identity >= threshold) return result.identity
  const rc = reverseComplement(needle)
  const resultRc = slidingWindowMatch(haystack, rc, maxMismatches)
  if (resultRc && resultRc.identity >= threshold) return resultRc.identity
  return 0
}

/** 抗性基因 feature 名称 → 数据库元件 standard_name 映射 */
const RESISTANCE_GENE_KEYWORD_MAP: Record<string, string> = {
  'aph': 'KanR', 'apha': 'KanR', 'aph3': 'KanR', 'aph3i': 'KanR', 'aph3ia': 'KanR',
  'npt': 'KanR', 'nptii': 'KanR', 'npt2': 'KanR',
  'neo': 'NeoR/KanR', 'neor': 'NeoR/KanR',
  'kanr': 'KanR', 'kan': 'KanR', 'kanamycin': 'KanR',
  '卡那霉素': 'KanR',
  'ampr': 'AmpR', 'amp': 'AmpR', 'bla': 'AmpR',
  '氨苄青霉素': 'AmpR', '氨苄': 'AmpR',
  'hygr': 'HygR', 'hyg': 'HygR', 'hygromycin': 'HygR', 'aph4': 'HygR',
  '潮霉素': 'HygR',
  'specr': 'SmR', 'spec': 'SmR', 'aada': 'SmR', 'smr': 'SmR',
  '壮观霉素': 'SmR',
  'cat': 'CmR', 'cmr': 'CmR', 'cam': 'CmR',
  '氯霉素': 'CmR',
  'tetr': 'TcR', 'tcr': 'TcR', 'tet': 'TcR',
  '四环素': 'TcR',
  'gentr': 'GmR', 'gmr': 'GmR', 'aacC1': 'GmR',
  '庆大霉素': 'GmR',
  'bleo': 'BleoR', 'ble': 'BleoR', 'zeor': 'BleoR',
  '博来霉素': 'BleoR',
  'puror': 'PuroR', 'puro': 'PuroR',
  '嘌呤霉素': 'PuroR',
  'bsd': 'BSD',
  '杀稻瘟菌素': 'BSD',
}

/** 元件类型关键词映射 */
const COMPONENT_TYPE_KEYWORD_MAP: Record<string, { stdName: string; type: string }> = {
  'f1ori': { stdName: 'f1 ori', type: 'origin' },
  'm13ori': { stdName: 'M13 ori', type: 'origin' },
  'cole1': { stdName: 'ColE1 ori', type: 'origin' },
  'pucori': { stdName: 'pUC ori', type: 'origin' },
  'p15aori': { stdName: 'p15A ori', type: 'origin' },
  'rep': { stdName: 'ori', type: 'origin' },
  '复制起点': { stdName: 'ori', type: 'origin' },
  '复制子': { stdName: 'ori', type: 'origin' },
  't7promoter': { stdName: 'T7 promoter', type: 'promoter' },
  't7启动子': { stdName: 'T7 promoter', type: 'promoter' },
  'cmvpromoter': { stdName: 'CMV promoter', type: 'promoter' },
  '35spromoter': { stdName: '35S promoter', type: 'promoter' },
  'adh1promoter': { stdName: 'ADH1 promoter', type: 'promoter' },
}

/** 根据 feature 名称在数据库中做回退匹配 */
function matchFeatureByName(
  featName: string,
  featType: string,
  nameCompCache: Array<{ comp: VectorComponent; nameNorm: string; aliasNorms: string[] }>
): { comp: VectorComponent } | null {
  if (!featName || featName.length < 2) return null
  const genericTypes = ['cds', 'gene', 'misc_feature', 'region', 'source', 'primer_bind']
  const normName = featName.toLowerCase().replace(/[\s_\-/]+/g, '')
  if (genericTypes.includes(normName)) return null

  for (const entry of nameCompCache) {
    if (entry.nameNorm === normName) return { comp: entry.comp }
    if (entry.aliasNorms.some(a => a === normName)) return { comp: entry.comp }
  }
  if (normName.length >= 4) {
    for (const entry of nameCompCache) {
      if (entry.nameNorm.length >= 4 && (
        entry.nameNorm.includes(normName) || normName.includes(entry.nameNorm)
      )) return { comp: entry.comp }
      if (entry.aliasNorms.some(a => a.length >= 4 && (
        a.includes(normName) || normName.includes(a)
      ))) return { comp: entry.comp }
    }
  }

  const targetName = RESISTANCE_GENE_KEYWORD_MAP[normName]
  if (targetName) {
    const targetNorm = targetName.toLowerCase().replace(/[\s_\-/]+/g, '')
    const found = nameCompCache.find(e => e.nameNorm === targetNorm)
    if (found) return { comp: found.comp }
  }
  for (const [keyword, stdName] of Object.entries(RESISTANCE_GENE_KEYWORD_MAP)) {
    if (normName.includes(keyword) || keyword.includes(normName)) {
      const targetNorm2 = stdName.toLowerCase().replace(/[\s_\-/]+/g, '')
      const found = nameCompCache.find(e => e.nameNorm === targetNorm2)
      if (found) return { comp: found.comp }
    }
  }

  for (const [keyword, { stdName, type: compType }] of Object.entries(COMPONENT_TYPE_KEYWORD_MAP)) {
    const kwNorm = keyword.toLowerCase().replace(/[\s_\-/]+/g, '')
    const stdNorm = stdName.toLowerCase().replace(/[\s_\-/]+/g, '')
    if (normName === kwNorm || normName === stdNorm ||
        (kwNorm.length >= 4 && (normName.includes(kwNorm) || kwNorm.includes(normName)))) {
      const found = nameCompCache.find(e =>
        (e.nameNorm === stdNorm || e.comp.type === compType) &&
        (e.nameNorm.includes(stdNorm) || stdNorm.includes(e.nameNorm) || e.nameNorm === stdNorm)
      )
      if (found) return { comp: found.comp }
      const typeFallback = nameCompCache.find(e => e.comp.type === compType)
      if (typeFallback) return { comp: typeFallback.comp }
    }
  }

  return null
}

// ============ 匹配坐标精确化 ============

/** 在 haystack 中查找 needle 的最佳匹配位置，返回位置、长度和相似度 */
function findBestDnaHit(
  haystack: string, needle: string, threshold: number
): { pos: number; len: number; identity: number } | null {
  if (!needle || !haystack || needle.length > haystack.length) return null
  const nLen = needle.length
  // 精确子串匹配
  let pos = haystack.indexOf(needle)
  if (pos >= 0) return { pos, len: nLen, identity: 100 }
  // 滑动窗口（允许 ≤10% 错配）
  const maxMM = Math.floor(nLen * 0.1)
  let best: { pos: number; len: number; identity: number } | null = null
  for (let i = 0; i <= haystack.length - nLen; i++) {
    let mm = 0
    for (let j = 0; j < nLen; j++) {
      if (haystack[i + j] !== needle[j]) { mm++; if (mm > maxMM) break }
    }
    if (mm <= maxMM) {
      const identity = Math.round(((nLen - mm) / nLen) * 100)
      if (identity >= threshold && (!best || identity > best.identity)) {
        best = { pos: i, len: nLen, identity }
        if (identity === 100) break
      }
    }
  }
  return best
}

/** 在 haystack 中搜索 needle 的最佳子序列匹配（允许更多错配，用于回退路径） */
function findBestPartialDnaHit(
  haystack: string, needle: string, threshold: number
): { pos: number; len: number; identity: number } | null {
  if (!needle || !haystack || needle.length > haystack.length) return null
  const nLen = needle.length
  const exactPos = haystack.indexOf(needle)
  if (exactPos >= 0) return { pos: exactPos, len: nLen, identity: 100 }
  const maxMM = Math.ceil(nLen * (1 - threshold / 100))
  let best: { pos: number; len: number; identity: number } | null = null
  for (let i = 0; i <= haystack.length - nLen; i++) {
    let mm = 0
    for (let j = 0; j < nLen; j++) {
      if (haystack[i + j] !== needle[j]) { mm++; if (mm > maxMM) break }
    }
    if (mm <= maxMM) {
      const identity = Math.round(((nLen - mm) / nLen) * 10000) / 100
      if (identity >= threshold && (!best || identity > best.identity)) {
        best = { pos: i, len: nLen, identity }
        if (identity === 100) break
      }
    }
  }
  return best
}

/** 基于 k-mer 哈希快速估算 needle 在 haystack 中的最佳匹配位置及 identity */
function estimateBestMatch(
  haystack: string, needle: string
): { pos: number; identity: number } | null {
  if (!needle || !haystack || needle.length > haystack.length || needle.length < 20) return null
  const K = 11
  if (needle.length < K) return null
  const kmerMap = new Map<string, number[]>()
  for (let i = 0; i <= haystack.length - K; i++) {
    const kmer = haystack.substring(i, i + K)
    const arr = kmerMap.get(kmer)
    if (arr) arr.push(i)
    else kmerMap.set(kmer, [i])
  }
  const posScores = new Map<number, number>()
  for (let j = 0; j <= needle.length - K; j++) {
    const kmer = needle.substring(j, j + K)
    const positions = kmerMap.get(kmer)
    if (!positions) continue
    for (const p of positions) {
      const offset = p - j
      if (offset < 0 || offset > haystack.length - needle.length) continue
      posScores.set(offset, (posScores.get(offset) || 0) + 1)
    }
  }
  if (posScores.size === 0) return null
  let bestPos = -1, bestScore = 0
  for (const [pos, score] of posScores) {
    if (score > bestScore) { bestScore = score; bestPos = pos }
  }
  if (bestPos < 0) return null
  let mm = 0
  for (let j = 0; j < needle.length; j++) {
    if (haystack[bestPos + j] !== needle[j]) mm++
  }
  const identity = Math.round(((needle.length - mm) / needle.length) * 10000) / 100
  return { pos: bestPos, identity }
}

/**
 * 精确化匹配坐标：将 match_start/match_end 从 feature 全范围修正为实际比对覆盖区间。
 * - nt-nt 匹配：在 feature DNA 中定位元件 DNA 的实际位置
 * - nt-aa 匹配：在 feature DNA 六框翻译中定位元件 AA 的实际位置并映射回 DNA 坐标
 * - name-match：保持原坐标
 * 同时计算 query_coverage（元件序列被比对覆盖的百分比）。
 */
function refineSmartMatchCoordinates(
  results: SmartMatchResult[],
  features: GenBankFeature[],
  vecSeq: string
): SmartMatchResult[] {
  const vec = vecSeq.toUpperCase().replace(/[^ATGC]/g, '')

  for (const r of results) {
    if (r.alignment_mode === 'name-match') {
      r.query_coverage = 0
      continue
    }

    const feat = features[r.feature_index]
    if (!feat) continue
    const featDNA = (r.feature_sequence || '').toUpperCase().replace(/[^ATGC]/g, '')
    if (!featDNA || featDNA.length < 10) continue

    // 获取元件的 DNA / AA 序列用于定位
    const compInfo = queryOne<{
      sequence: string; amino_acid_sequence: string; ref_protein_sequence: string
    }>('SELECT sequence, amino_acid_sequence, ref_protein_sequence FROM vector_components WHERE id = ?',
      [r.match_component_id])
    if (!compInfo) { r.query_coverage = 100; continue }

    const compDNA = (compInfo.sequence || '').toUpperCase().replace(/[^ATGC]/g, '')
    const compAA = (compInfo.amino_acid_sequence || compInfo.ref_protein_sequence || '')
      .toUpperCase().replace(/[^A-Z*]/g, '')

    if (r.alignment_mode === 'nt-nt' && compDNA.length >= 10 && isValidDna(compDNA)) {
      // 1. 在 feature DNA 正向搜索元件 DNA（处理正向匹配）
      const hit = findBestDnaHit(featDNA, compDNA, 80)
      if (hit) {
        // 正向命中：坐标直接映射到载体正向坐标
        r.match_start = feat.start + 1 + hit.pos
        r.match_end = feat.start + 1 + hit.pos + hit.len
        r.query_coverage = Math.min(100, Math.round((hit.len / compDNA.length) * 1000) / 10)
        // 元件匹配范围：整个元件被匹配
        r.component_match_start = 1
        r.component_match_end = compDNA.length
        continue
      }
      // 2. 在 RC(feature DNA) 搜索元件 DNA（处理反向互补匹配）
      //    slidingWindowSimilarity 在匹配阶段会检查 RC(compDNA)，
      //    所以元件的 RC 可能是 featDNA 的子串，但元件本身不是
      const featRc = reverseComplement(featDNA)
      const rcHit = findBestDnaHit(featRc, compDNA, 80)
      if (rcHit) {
        // RC 坐标转换回正向坐标：
        // compDNA 在 RC(featDNA) 的 rcHit.pos 处命中
        // → 正向 DNA 的 (L - rcHit.pos - hitLen) 处
        r.match_start = feat.end - rcHit.len - rcHit.pos
        r.match_end = feat.end - rcHit.pos
        r.query_coverage = Math.min(100, Math.round((rcHit.len / compDNA.length) * 1000) / 10)
        // 元件匹配范围：整个元件被匹配
        r.component_match_start = 1
        r.component_match_end = compDNA.length
        continue
      }
      // 3. 元件 DNA 比 feature DNA 长时，反向搜索
      if (compDNA.length > featDNA.length) {
        const revHit = findBestDnaHit(compDNA, featDNA, 80)
        if (revHit) {
          r.query_coverage = Math.min(100, Math.round((featDNA.length / compDNA.length) * 1000) / 10)
          // 元件匹配范围：只有部分元件被匹配
          r.component_match_start = revHit.pos + 1
          r.component_match_end = revHit.pos + revHit.len
          continue
        }
        // 也在 RC(compDNA) 中搜索 featDNA
        const compRc = reverseComplement(compDNA)
        const revRcHit = findBestDnaHit(compRc, featDNA, 80)
        if (revRcHit) {
          r.query_coverage = Math.min(100, Math.round((featDNA.length / compDNA.length) * 1000) / 10)
          // 元件匹配范围：RC 位置需要转换回正向坐标
          const fwdStart = compDNA.length - revRcHit.pos - revRcHit.len
          r.component_match_start = fwdStart + 1
          r.component_match_end = fwdStart + revRcHit.len
          continue
        }
      }
    }

    if (r.alignment_mode === 'nt-aa' && compAA.length >= 5 && featDNA.length >= 30) {
      // 在 feature DNA 六框翻译中定位元件 AA
      const frames = sixFrameTranslation(featDNA)
      let bestHit: {
        pos: number; protLen: number; identity: number; frameIdx: number
      } | null = null

      for (let fi = 0; fi < frames.length; fi++) {
        const frameAA = frames[fi]
        if (!frameAA || frameAA.length < compAA.length) continue
        const sw = slidingWindowMatch(frameAA, compAA, Math.floor(compAA.length * 0.2))
        if (sw && sw.identity >= 75 && (!bestHit || sw.identity > bestHit.identity)) {
          bestHit = { pos: sw.pos, protLen: compAA.length, identity: sw.identity, frameIdx: fi }
          if (sw.identity === 100) break
        }
      }

      if (bestHit) {
        const frame = bestHit.frameIdx % 3
        const isRC = bestHit.frameIdx >= 3
        const dnaSpan = bestHit.protLen * 3

        if (!isRC) {
          const dnaStartInFeat = frame + bestHit.pos * 3
          if (r.strand === 1) {
            r.match_start = feat.start + 1 + dnaStartInFeat
            r.match_end = feat.start + 1 + dnaStartInFeat + dnaSpan
          } else {
            r.match_start = feat.end - dnaStartInFeat - dnaSpan
            r.match_end = feat.end - dnaStartInFeat
          }
        } else {
          const rcDnaStart = frame + bestHit.pos * 3
          const fwdDnaStart = featDNA.length - rcDnaStart - dnaSpan
          if (fwdDnaStart >= 0) {
            if (r.strand === 1) {
              r.match_start = feat.start + 1 + fwdDnaStart
              r.match_end = feat.start + 1 + fwdDnaStart + dnaSpan
            } else {
              r.match_start = feat.end - fwdDnaStart - dnaSpan
              r.match_end = feat.end - fwdDnaStart
            }
          }
        }
        r.query_coverage = Math.round((bestHit.protLen / compAA.length) * 1000) / 10
        continue
      }
    }

    // 无法精确化（序列数据不足等），保留原坐标
    r.query_coverage = 100
  }

  return results
}

/**
 * 综合评分：综合考虑序列相似度和元件序列覆盖度。
 * compositeScore = similarity * 0.6 + query_coverage * 0.4
 * 当 query_coverage 接近 100% 时（元件长度与匹配区间高度一致），该候选优先排列。
 */
function compositeScore(similarity: number, queryCoverage: number | undefined): number {
  const qc = queryCoverage != null ? queryCoverage : 100
  return similarity * 0.6 + qc * 0.4
}

/** 填充 partial_match_note（当 query_coverage < 50% 时） */
function fillPartialMatchNote(r: SmartMatchResult, compDnaLen: number): void {
  if (r.query_coverage != null && r.query_coverage > 0 && r.query_coverage < 50 && compDnaLen > 0) {
    const matchLen = r.match_end - r.match_start
    r.partial_match_note = `仅匹配元件序列的 ${Math.round(r.query_coverage)}%（${matchLen}/${compDnaLen}bp），建议使用更精确的子序列元件`
  }
}

/**
 * 基于精确化坐标的候选聚类：将匹配到同一 feature 且坐标高度重叠的匹配项合并为一组。
 * 聚类条件（同时满足）：
 * - 匹配到同一个 feature_index
 * - 坐标重叠度 > 70%（基于精确化后的 match_start/match_end）
 * - 匹配区间长度差异 ≤ 30%（载体匹配 105bp 时，元件长度最多约 105±15%）
 * 每组保留综合评分最高的作为主匹配，其余作为该主匹配的 candidates。
 */
function clusterOverlappingMatches(results: SmartMatchResult[]): SmartMatchResult[] {
  if (results.length <= 1) {
    // 即使无需聚类，也要填充 partial_match_note
    for (const r of results) {
      if (r.query_coverage != null && r.query_coverage < 50) {
        const matchLen = r.match_end - r.match_start
        fillPartialMatchNote(r, Math.round(matchLen / (r.query_coverage / 100)) || matchLen)
      }
    }
    return results
  }

  // 按 feature_index 分组
  const groups = new Map<number, SmartMatchResult[]>()
  for (const r of results) {
    if (!groups.has(r.feature_index)) groups.set(r.feature_index, [])
    groups.get(r.feature_index)!.push(r)
  }

  const clustered: SmartMatchResult[] = []

  for (const [, group] of groups) {
    // 按综合评分降序排列（综合 similarity + query_coverage）
    group.sort((a, b) => compositeScore(b.similarity, b.query_coverage) - compositeScore(a.similarity, a.query_coverage))

    const used = new Set<number>()

    for (let i = 0; i < group.length; i++) {
      if (used.has(i)) continue
      const primary = group[i]
      used.add(i)

      const primaryLen = primary.match_end - primary.match_start
      if (primaryLen <= 0) {
        clustered.push(primary)
        continue
      }

      // 查找与 primary 坐标高度重叠的其他匹配
      const absorbed: SmartMatchCandidate[] = []
      for (let j = i + 1; j < group.length; j++) {
        if (used.has(j)) continue
        const other = group[j]
        const otherLen = other.match_end - other.match_start
        if (otherLen <= 0) continue

        // 长度差异检查
        const maxLen = Math.max(primaryLen, otherLen)
        const minLen = Math.min(primaryLen, otherLen)
        if (maxLen === 0) continue
        const lenDiff = Math.abs(primaryLen - otherLen) / maxLen
        if (lenDiff > 0.3) continue

        // 坐标重叠度检查
        const overlapStart = Math.max(primary.match_start, other.match_start)
        const overlapEnd = Math.min(primary.match_end, other.match_end)
        const overlap = Math.max(0, overlapEnd - overlapStart)
        const overlapRatio = overlap / minLen
        if (overlapRatio < 0.7) continue

        // 满足聚类条件，将 other 作为 primary 的候选
        used.add(j)
        // 估算元件序列长度
        const estCompLen = other.query_coverage != null && other.query_coverage > 0
          ? Math.round(otherLen / (other.query_coverage / 100))
          : otherLen
        absorbed.push({
          component_id: other.match_component_id,
          standard_name: other.match_component_name,
          similarity: other.similarity,
          component_type: other.component_type,
          alignment_mode: other.alignment_mode,
          tags: other.tags,
          query_coverage: other.query_coverage,
          match_start: other.match_start,
          match_end: other.match_end,
          component_seq_length: estCompLen,
          component_match_start: other.component_match_start,
          component_match_end: other.component_match_end,
        })
      }

      // 合并已有 candidates 与新聚类的候选
      if (absorbed.length > 0 || (primary.candidates && primary.candidates.length > 0)) {
        const allCandidates = [...absorbed, ...(primary.candidates || [])]
        // 去重（按 component_id）并按综合评分降序
        const seen = new Set<number>()
        const uniqueCandidates: SmartMatchCandidate[] = []
        for (const c of allCandidates) {
          if (!seen.has(c.component_id)) {
            seen.add(c.component_id)
            uniqueCandidates.push(c)
          }
        }
        uniqueCandidates.sort((a, b) => compositeScore(b.similarity, b.query_coverage) - compositeScore(a.similarity, a.query_coverage))
        primary.candidates = uniqueCandidates.slice(0, 5)
      }

      clustered.push(primary)
    }
  }

  // 填充 partial_match_note（对所有结果）
  for (const r of clustered) {
    if (r.query_coverage != null && r.query_coverage < 50) {
      const matchLen = r.match_end - r.match_start
      fillPartialMatchNote(r, Math.round(matchLen / (r.query_coverage / 100)) || matchLen)
    }
  }

  return clustered
}

/**
 * 智能标注元件：对载体中的每个 feature，在元件数据库中做全局序列比对，
 * nt-nt ≥99% 或 nt-aa ≥90% 视为匹配。序列比对全部失败时，回退到名称匹配。
 *
 * 一对多支持：一个 feature 可同时匹配多个数据库元件（qualifiedMap 按 component_id 收集所有达标匹配）。
 * 候选收集：额外收集 ≥80% (nt-nt) / ≥75% (nt-aa) 的候选，附加到 candidates 字段供用户选择。
 * 嵌套元件：每个 feature 独立比对，互不干扰。
 */
/**
 * 智能标注全序列扫描（IPC 路径）：不依赖现有 features，直接用元件数据库中的每个元件序列
 * 在载体全序列上做子序列搜索（正向 + 反向互补），根据相似度和覆盖度筛选命中。
 *
 * **新架构**：不再依赖现有 feature 边界，直接扫描载体全序列。
 * 与 Worker 路径（smartAnnotatePure）逻辑完全一致。
 *
 * @param vectorSequence 载体全序列
 */
export function smartAnnotateComponents(vectorSequence: string): SmartMatchResult[] {
  if (!vectorSequence) return []
  const vecSeq = vectorSequence.toUpperCase().replace(/[^ATGC]/g, '')
  if (vecSeq.length < 10) return []

  const NT_THRESHOLD = 90
  const AA_THRESHOLD = 85
  const NT_COV_THRESHOLD = 70
  const AA_COV_THRESHOLD = 70

  const components = queryAll<VectorComponent>(
    'SELECT id, standard_name, sequence, amino_acid_sequence, type, tags FROM vector_components WHERE (sequence IS NOT NULL AND sequence != \'\') OR (amino_acid_sequence IS NOT NULL AND amino_acid_sequence != \'\')'
  )
  console.log(`[SmartAnnotate] Whole-sequence scan: ${components.length} components, vecLen=${vecSeq.length}`)

  // 构建比对缓存
  interface CachedComp {
    id: number; standard_name: string; type: VectorComponentType; tags?: string
    dna: string; rc: string; aa: string; hasDna: boolean; hasAa: boolean
  }
  const compCache: CachedComp[] = components.map(c => {
    const rawDna = (c.sequence || '').replace(/\s/g, '')
    const dna = rawDna.toUpperCase().replace(/[^ATGC]/g, '')
    const hasDna = isValidDna(rawDna) && dna.length >= 10
    const rawAa = (c.amino_acid_sequence || '').replace(/\s/g, '')
    const aa = rawAa.toUpperCase().replace(/[^A-Z*]/g, '')
    const hasAa = isValidProtein(rawAa) && aa.length >= 5
    const rc = hasDna ? reverseComplement(dna) : ''
    return { id: c.id, standard_name: c.standard_name, type: c.type, tags: c.tags, dna, rc, aa, hasDna, hasAa }
  })

  // 诊断日志：元件序列统计
  const hasDnaCount = compCache.filter(c => c.hasDna).length
  const hasAaCount = compCache.filter(c => c.hasAa).length
  const hasNoSeqCount = compCache.filter(c => !c.hasDna && !c.hasAa).length
  console.log(`[SmartAnnotate-IPC] Component stats: ${hasDnaCount} with DNA, ${hasAaCount} with AA, ${hasNoSeqCount} without seq`)

  // 载体 6 帧翻译（用于 nt-aa 匹配）
  const vecFwdFrames = translateAllFrames(vecSeq)
  const vecRcFrames = translateAllFrames(reverseComplement(vecSeq))
  const vecAllFrames = [...vecFwdFrames, ...vecRcFrames]

  // 收集所有原始命中
  interface RawHit {
    componentId: number; componentName: string; componentType: VectorComponentType; tags?: string
    matchStart: number; matchEnd: number; strand: 1 | -1
    similarity: number; queryCoverage: number
    componentMatchStart: number; componentMatchEnd: number
    alignmentMode: 'nt-nt' | 'nt-aa'
  }
  const allHits: RawHit[] = []

  for (const comp of compCache) {
    // nt-nt 匹配
    if (comp.hasDna) {
      let fwdFound = false
      let rcFound = false

      // 正向搜索
      const fwdHit = findBestDnaHit(vecSeq, comp.dna, NT_THRESHOLD)
      if (fwdHit && fwdHit.identity >= NT_THRESHOLD) {
        const queryCov = Math.min(100, Math.round((fwdHit.len / comp.dna.length) * 1000) / 10)
        if (queryCov >= NT_COV_THRESHOLD) {
          fwdFound = true
          allHits.push({
            componentId: comp.id, componentName: comp.standard_name, componentType: comp.type, tags: comp.tags,
            matchStart: fwdHit.pos + 1, matchEnd: fwdHit.pos + fwdHit.len, strand: 1,
            similarity: fwdHit.identity, queryCoverage: queryCov,
            componentMatchStart: 1, componentMatchEnd: fwdHit.len, alignmentMode: 'nt-nt'
          })
        }
      }
      // RC 搜索
      const rcHit = findBestDnaHit(vecSeq, comp.rc, NT_THRESHOLD)
      if (rcHit && rcHit.identity >= NT_THRESHOLD) {
        const queryCov = Math.min(100, Math.round((rcHit.len / comp.dna.length) * 1000) / 10)
        if (queryCov >= NT_COV_THRESHOLD) {
          rcFound = true
          allHits.push({
            componentId: comp.id, componentName: comp.standard_name, componentType: comp.type, tags: comp.tags,
            matchStart: rcHit.pos + 1, matchEnd: rcHit.pos + rcHit.len, strand: -1,
            similarity: rcHit.identity, queryCoverage: queryCov,
            componentMatchStart: 1, componentMatchEnd: rcHit.len, alignmentMode: 'nt-nt'
          })
        }
      }

      // ── 回退路径 1：元件 DNA 比载体更长时（如完整质粒 vs 载体） ──
      if (!fwdFound && !rcFound && comp.dna.length > vecSeq.length) {
        const subHit = findBestDnaHit(comp.dna, vecSeq, NT_THRESHOLD)
        if (subHit && subHit.identity >= NT_THRESHOLD) {
          const queryCov = Math.min(100, Math.round((subHit.len / comp.dna.length) * 1000) / 10)
          if (queryCov >= NT_COV_THRESHOLD) {
            fwdFound = true
            allHits.push({
              componentId: comp.id, componentName: comp.standard_name, componentType: comp.type, tags: comp.tags,
              matchStart: 1, matchEnd: vecSeq.length, strand: 1,
              similarity: subHit.identity, queryCoverage: queryCov,
              componentMatchStart: subHit.pos + 1, componentMatchEnd: subHit.pos + subHit.len, alignmentMode: 'nt-nt'
            })
          }
        }
        if (!fwdFound) {
          const vecRc = reverseComplement(vecSeq)
          const subRcHit = findBestDnaHit(comp.dna, vecRc, NT_THRESHOLD)
          if (subRcHit && subRcHit.identity >= NT_THRESHOLD) {
            const queryCov = Math.min(100, Math.round((subRcHit.len / comp.dna.length) * 1000) / 10)
            if (queryCov >= NT_COV_THRESHOLD) {
              rcFound = true
              allHits.push({
                componentId: comp.id, componentName: comp.standard_name, componentType: comp.type, tags: comp.tags,
                matchStart: 1, matchEnd: vecSeq.length, strand: -1,
                similarity: subRcHit.identity, queryCoverage: queryCov,
                componentMatchStart: subRcHit.pos + 1, componentMatchEnd: subRcHit.pos + subRcHit.len, alignmentMode: 'nt-nt'
              })
            }
          }
        }
      }

      // ── 回退路径 2：基于编辑距离的局部比对 ──
      if (!fwdFound && !rcFound) {
        const fwdSim = calcSeqSimilarity(comp.dna, vecSeq, NT_THRESHOLD)
        if (fwdSim >= NT_THRESHOLD) {
          const queryCov = Math.min(100, Math.round((Math.min(comp.dna.length, vecSeq.length) / comp.dna.length) * 1000) / 10)
          if (queryCov >= NT_COV_THRESHOLD) {
            let ms = 1, me = vecSeq.length, cms = 1, cme = comp.dna.length
            const refineHit = findBestDnaHit(vecSeq, comp.dna, 80)
            if (refineHit) {
              ms = refineHit.pos + 1; me = refineHit.pos + refineHit.len
              cms = 1; cme = refineHit.len
            } else {
              const refineHit2 = findBestDnaHit(comp.dna, vecSeq, 80)
              if (refineHit2) { cms = refineHit2.pos + 1; cme = refineHit2.pos + refineHit2.len }
            }
            fwdFound = true
            allHits.push({
              componentId: comp.id, componentName: comp.standard_name, componentType: comp.type, tags: comp.tags,
              matchStart: ms, matchEnd: me, strand: 1,
              similarity: fwdSim, queryCoverage: queryCov,
              componentMatchStart: cms, componentMatchEnd: cme, alignmentMode: 'nt-nt'
            })
          }
        }
        if (!fwdFound) {
          const rcSim = calcSeqSimilarity(comp.rc, vecSeq, NT_THRESHOLD)
          if (rcSim >= NT_THRESHOLD) {
            const queryCov = Math.min(100, Math.round((Math.min(comp.dna.length, vecSeq.length) / comp.dna.length) * 1000) / 10)
            if (queryCov >= NT_COV_THRESHOLD) {
              let ms = 1, me = vecSeq.length, cms = 1, cme = comp.dna.length
              const refineHit = findBestDnaHit(vecSeq, comp.rc, 80)
              if (refineHit) {
                ms = refineHit.pos + 1; me = refineHit.pos + refineHit.len
                cms = 1; cme = refineHit.len
              }
              rcFound = true
              allHits.push({
                componentId: comp.id, componentName: comp.standard_name, componentType: comp.type, tags: comp.tags,
                matchStart: ms, matchEnd: me, strand: -1,
                similarity: rcSim, queryCoverage: queryCov,
                componentMatchStart: cms, componentMatchEnd: cme, alignmentMode: 'nt-nt'
              })
            }
          }
        }
      }

      // ── 回退路径 3：宽松阈值部分匹配（85% similarity，处理序列变异） ──
      if (!fwdFound && !rcFound) {
        const RELAXED_THRESHOLD = 85
        const RELAXED_COV = 60
        const partialFwdHit = findBestPartialDnaHit(vecSeq, comp.dna, RELAXED_THRESHOLD)
        if (partialFwdHit) {
          const queryCov = Math.min(100, Math.round((partialFwdHit.len / comp.dna.length) * 1000) / 10)
          if (queryCov >= RELAXED_COV) {
            fwdFound = true
            allHits.push({
              componentId: comp.id, componentName: comp.standard_name, componentType: comp.type, tags: comp.tags,
              matchStart: partialFwdHit.pos + 1, matchEnd: partialFwdHit.pos + partialFwdHit.len, strand: 1,
              similarity: partialFwdHit.identity, queryCoverage: queryCov,
              componentMatchStart: 1, componentMatchEnd: partialFwdHit.len, alignmentMode: 'nt-nt'
            })
          }
        }
        if (!fwdFound) {
          const partialRcHit = findBestPartialDnaHit(vecSeq, comp.rc, RELAXED_THRESHOLD)
          if (partialRcHit) {
            const queryCov = Math.min(100, Math.round((partialRcHit.len / comp.dna.length) * 1000) / 10)
            if (queryCov >= RELAXED_COV) {
              rcFound = true
              allHits.push({
                componentId: comp.id, componentName: comp.standard_name, componentType: comp.type, tags: comp.tags,
                matchStart: partialRcHit.pos + 1, matchEnd: partialRcHit.pos + partialRcHit.len, strand: -1,
                similarity: partialRcHit.identity, queryCoverage: queryCov,
                componentMatchStart: 1, componentMatchEnd: partialRcHit.len, alignmentMode: 'nt-nt'
              })
            }
          }
        }
      }

      // 诊断日志：KanR（含实际最佳匹配分数）
      if (/kan/i.test(comp.standard_name)) {
        const bestFwd = estimateBestMatch(vecSeq, comp.dna)
        const bestRc = estimateBestMatch(vecSeq, comp.rc)
        console.log(`[SmartAnnotate-IPC] KanR diag: "${comp.standard_name}" dnaLen=${comp.dna.length} rcLen=${comp.rc.length}`,
          `fwdFound=${fwdFound} rcFound=${rcFound}`,
          `bestFwd=${bestFwd ? `${bestFwd.identity}%@${bestFwd.pos}` : 'null'}`,
          `bestRc=${bestRc ? `${bestRc.identity}%@${bestRc.pos}` : 'null'}`)
      }
    }

    // nt-aa 匹配（降低阈值以捕获反向链和密码子简并性变异）
    if (comp.hasAa) {
      for (let fi = 0; fi < vecAllFrames.length; fi++) {
        const frameAA = vecAllFrames[fi]
        if (!frameAA || frameAA.length < comp.aa.length) continue
        const maxMM = Math.floor(comp.aa.length * (1 - AA_THRESHOLD / 100))
        const sw = slidingWindowMatch(frameAA, comp.aa, maxMM)
        if (sw && sw.identity >= AA_THRESHOLD) {
          const isRC = fi >= 3
          const frame = fi % 3
          // 修正密码子→DNA 坐标映射：统计终止密码子
          const stopsBefore = countStopsBefore(frameAA, sw.pos)
          const stopsInMatch = countStopsBefore(frameAA, sw.pos + comp.aa.length) - stopsBefore
          const codonStart = sw.pos + stopsBefore
          const codonEnd = sw.pos + comp.aa.length + stopsBefore + stopsInMatch
          const dnaSpanStart = frame + codonStart * 3
          const dnaSpanEnd = frame + codonEnd * 3
          let matchStart: number, matchEnd: number, strand: 1 | -1
          if (!isRC) {
            matchStart = dnaSpanStart + 1; matchEnd = dnaSpanEnd; strand = 1
          } else {
            matchStart = vecSeq.length - dnaSpanEnd + 1; matchEnd = vecSeq.length - dnaSpanStart; strand = -1
          }
          const queryCov = Math.min(100, Math.round((comp.aa.length / comp.aa.length) * 1000) / 10)
          if (queryCov >= AA_COV_THRESHOLD) {
            allHits.push({
              componentId: comp.id, componentName: comp.standard_name, componentType: comp.type, tags: comp.tags,
              matchStart, matchEnd, strand,
              similarity: sw.identity, queryCoverage: queryCov,
              componentMatchStart: sw.pos + 1, componentMatchEnd: sw.pos + comp.aa.length, alignmentMode: 'nt-aa'
            })
          }
        }
      }

      // ── 回退路径 4：DNA→AA 反向搜索（元件 AA 在载体六框翻译中搜索） ──
      // 处理 nt-nt 完全失败但蛋白级有匹配的情况
      if (!allHits.some(h => h.componentId === comp.id)) {
        for (let fi = 0; fi < vecAllFrames.length; fi++) {
          const frameAA = vecAllFrames[fi]
          if (!frameAA || frameAA.length < comp.aa.length) continue
          const maxMM = Math.floor(comp.aa.length * 0.25)
          const sw = slidingWindowMatch(frameAA, comp.aa, maxMM)
          if (sw && sw.identity >= 75) {
            const isRC = fi >= 3
            const frame = fi % 3
            const stopsBefore = countStopsBefore(frameAA, sw.pos)
            const stopsInMatch = countStopsBefore(frameAA, sw.pos + comp.aa.length) - stopsBefore
            const codonStart = sw.pos + stopsBefore
            const codonEnd = sw.pos + comp.aa.length + stopsBefore + stopsInMatch
            const dnaSpanStart = frame + codonStart * 3
            const dnaSpanEnd = frame + codonEnd * 3
            let matchStart: number, matchEnd: number, strand: 1 | -1
            if (!isRC) {
              matchStart = dnaSpanStart + 1; matchEnd = dnaSpanEnd; strand = 1
            } else {
              matchStart = vecSeq.length - dnaSpanEnd + 1; matchEnd = vecSeq.length - dnaSpanStart; strand = -1
            }
            const queryCov = Math.min(100, Math.round((comp.aa.length / comp.aa.length) * 1000) / 10)
            allHits.push({
              componentId: comp.id, componentName: comp.standard_name, componentType: comp.type, tags: comp.tags,
              matchStart, matchEnd, strand,
              similarity: sw.identity, queryCoverage: queryCov,
              componentMatchStart: sw.pos + 1, componentMatchEnd: sw.pos + comp.aa.length, alignmentMode: 'nt-aa'
            })
            break
          }
        }
      }
    }
  }

  console.log(`[SmartAnnotate-IPC] Raw hits: ${allHits.length}`)

  // 诊断日志：未匹配元件
  const matchedCompIds = new Set(allHits.map(h => h.componentId))
  const unmatchedComps = compCache.filter(c => (c.hasDna || c.hasAa) && !matchedCompIds.has(c.id))
  if (unmatchedComps.length > 0) {
    console.log(`[SmartAnnotate-IPC] ❌ ${unmatchedComps.length} components NOT matched:`,
      unmatchedComps.map(c => `${c.standard_name}(dna:${c.dna.length},aa:${c.aa.length})`))
  }

  // 按坐标排序
  allHits.sort((a, b) => a.matchStart - b.matchStart || b.similarity - a.similarity)

  // 聚类去重
  const clustered: SmartMatchResult[] = []
  const used = new Set<number>()

  for (let i = 0; i < allHits.length; i++) {
    if (used.has(i)) continue
    const primary = allHits[i]
    used.add(i)
    const primaryLen = primary.matchEnd - primary.matchStart
    const absorbed: SmartMatchCandidate[] = []

    for (let j = i + 1; j < allHits.length; j++) {
      if (used.has(j)) continue
      const other = allHits[j]
      const otherLen = other.matchEnd - other.matchStart
      if (otherLen <= 0) continue
      const maxLen = Math.max(primaryLen, otherLen)
      if (maxLen === 0) continue
      if (Math.abs(primaryLen - otherLen) / maxLen > 0.3) continue
      const overlapStart = Math.max(primary.matchStart, other.matchStart)
      const overlapEnd = Math.min(primary.matchEnd, other.matchEnd)
      const overlap = Math.max(0, overlapEnd - overlapStart)
      if (overlap / Math.min(primaryLen, otherLen) < 0.7) continue
      used.add(j)
      absorbed.push({
        component_id: other.componentId, standard_name: other.componentName,
        similarity: other.similarity, component_type: other.componentType,
        alignment_mode: other.alignmentMode, tags: other.tags,
        query_coverage: other.queryCoverage,
        match_start: other.matchStart, match_end: other.matchEnd,
        component_seq_length: other.queryCoverage > 0 ? Math.round(otherLen / (other.queryCoverage / 100)) : otherLen,
        component_match_start: other.componentMatchStart, component_match_end: other.componentMatchEnd
      })
    }

    const seen = new Set<number>([primary.componentId])
    const uniqueCandidates: SmartMatchCandidate[] = []
    for (const c of absorbed) {
      if (!seen.has(c.component_id)) { seen.add(c.component_id); uniqueCandidates.push(c) }
    }
    uniqueCandidates.sort((a, b) => compositeScore(b.similarity, b.query_coverage) - compositeScore(a.similarity, a.query_coverage))

    const estCompLen = primary.queryCoverage > 0 ? Math.round(primaryLen / (primary.queryCoverage / 100)) : primaryLen
    const result: SmartMatchResult = {
      feature_index: -1, feature_name: '', feature_type: primary.componentType,
      feature_sequence: vecSeq.substring(primary.matchStart - 1, primary.matchEnd),
      match_component_id: primary.componentId, match_component_name: primary.componentName,
      match_type: primary.similarity >= 100 ? 'exact' : 'partial',
      similarity: primary.similarity, alignment_mode: primary.alignmentMode,
      match_start: primary.matchStart, match_end: primary.matchEnd, strand: primary.strand,
      component_type: primary.componentType, tags: primary.tags,
      query_coverage: primary.queryCoverage,
      component_match_start: primary.componentMatchStart, component_match_end: primary.componentMatchEnd,
      candidates: uniqueCandidates.slice(0, 5)
    }
    if (result.query_coverage != null && result.query_coverage < 50) {
      fillPartialMatchNote(result, estCompLen)
    }
    clustered.push(result)
  }

  clustered.sort((a, b) => compositeScore(b.similarity, b.query_coverage) - compositeScore(a.similarity, a.query_coverage))
  console.log(`[SmartAnnotate] Final results: ${clustered.length} matches`)
  return clustered
}

// ============ 单序列识别 ============

/** 对单个元件序列进行数据库匹配识别，返回按相似度降序排列的候选列表（最多10个） */
export function identifyFeatureSequence(featureSeq: string): Array<{
  component_id: number; standard_name: string; component_type: string;
  species: string; identity: number; match_type: 'exact' | 'partial'
}> {
  if (!featureSeq) return []
  if (!isValidDna(featureSeq.replace(/\s/g, ''))) return []
  const qSeq = featureSeq.toUpperCase().replace(/[^ATGC]/g, '')
  if (qSeq.length < 10) return []

  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }
  const revComp = (s: string) => s.split('').reverse().map(c => comp[c] || c).join('')

  const components = queryAll<VectorComponent>('SELECT * FROM vector_components WHERE sequence IS NOT NULL AND sequence != \'\'')
  const results: Array<{ component_id: number; standard_name: string; component_type: string; species: string; identity: number; match_type: 'exact' | 'partial' }> = []

  for (const dbComp of components) {
    const rawDbSeq = (dbComp.sequence || '').replace(/\s/g, '')
    const dbSeq = dbComp.sequence.toUpperCase().replace(/[^ATGC]/g, '')
    if (!isValidDna(rawDbSeq) || dbSeq.length < 10) continue

    let bestIdentity = 0
    let bestType: 'exact' | 'partial' = 'partial'

    for (const [haystack, needle] of [[dbSeq, qSeq], [qSeq, dbSeq]] as [string, string][]) {
      if (haystack.length < needle.length) continue
      const windowSize = needle.length
      const maxMismatches = Math.floor(windowSize * 0.15)

      for (let i = 0; i <= haystack.length - windowSize; i++) {
        let mm = 0
        for (let j = 0; j < windowSize; j++) {
          if (haystack[i + j] !== needle[j]) { if (++mm > maxMismatches) break }
        }
        if (mm <= maxMismatches) {
          const id = Math.round(((windowSize - mm) / windowSize) * 100)
          if (id > bestIdentity) { bestIdentity = id; bestType = mm === 0 ? 'exact' : 'partial' }
          if (id === 100) break
        }
      }
      if (bestIdentity === 100) break

      const rcNeedle = revComp(needle)
      for (let i = 0; i <= haystack.length - windowSize; i++) {
        let mm = 0
        for (let j = 0; j < windowSize; j++) {
          if (haystack[i + j] !== rcNeedle[j]) { if (++mm > maxMismatches) break }
        }
        if (mm <= maxMismatches) {
          const id = Math.round(((windowSize - mm) / windowSize) * 100)
          if (id > bestIdentity) { bestIdentity = id; bestType = mm === 0 ? 'exact' : 'partial' }
          if (id === 100) break
        }
      }
      if (bestIdentity === 100) break
    }

    if (bestIdentity >= 80) {
      results.push({
        component_id: dbComp.id,
        standard_name: dbComp.standard_name,
        component_type: dbComp.type,
        species: dbComp.species || '',
        identity: bestIdentity,
        match_type: bestType
      })
    }
  }

  results.sort((a, b) => b.identity - a.identity)
  return results.slice(0, 10)
}
