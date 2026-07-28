/**
 * In-silico PCR 模拟扩增模块
 * 验证引物对是否能特异性扩增目标片段
 */

/** 扩增产物信息 */
export interface PcrProduct {
  /** 产物起始位置 (0-based) */
  start: number
  /** 产物结束位置 (0-based, exclusive) */
  end: number
  /** 产物长度 */
  length: number
  /** 正向引物错配数 */
  fwdMismatches: number
  /** 反向引物错配数 */
  revMismatches: number
  /** 是否为目标产物 */
  isExpected: boolean
  /** 正向引物结合位置 */
  fwdBindPos: number
  /** 反向引物结合位置 */
  revBindPos: number
}

/** In-silico PCR 结果 */
export interface InSilicoPcrResult {
  /** 扩增产物列表 */
  products: PcrProduct[]
  /** 是否为特异性扩增（仅有目标产物） */
  isSpecific: boolean
  /** 目标产物数量 */
  expectedProductCount: number
  /** 非特异产物数量 */
  unexpectedProductCount: number
  /** 目标产物长度范围 */
  expectedLengthRange?: { min: number; max: number }
}

/**
 * 模拟 PCR 扩增
 * @param fwdPrimer 正向引物序列 (5'→3')
 * @param revPrimer 反向引物序列 (5'→3')
 * @param template 模板序列
 * @param expectedStart 预期产物起始位置 (0-based)
 * @param expectedEnd 预期产物结束位置 (0-based, exclusive)
 * @param maxMismatches 最大允许错配数 (default 2)
 * @param maxProductLength 最大产物长度 (default 3000)
 */
export function runInSilicoPcr(
  fwdPrimer: string,
  revPrimer: string,
  template: string,
  expectedStart: number,
  expectedEnd: number,
  maxMismatches: number = 2,
  maxProductLength: number = 3000
): InSilicoPcrResult {
  const fwd = fwdPrimer.toUpperCase()
  const rev = revPrimer.toUpperCase()
  const t = template.toUpperCase()
  const tLen = t.length
  
  if (fwd.length < 8 || rev.length < 8 || tLen < fwd.length + rev.length) {
    return {
      products: [],
      isSpecific: false,
      expectedProductCount: 0,
      unexpectedProductCount: 0
    }
  }
  
  // 反向引物的反向互补（因为反向引物结合在模板的正向链上）
  const revRC = reverseComplement(rev)
  
  const products: PcrProduct[] = []
  
  // 查找正向引物结合位点
  const fwdBindSites = findBindingSites(fwd, t, maxMismatches)
  
  // 查找反向引物结合位点（在其反向互补链上）
  const revBindSites = findBindingSites(revRC, t, maxMismatches)
  
  // 组合所有可能的产物
  for (const fwdSite of fwdBindSites) {
    for (const revSite of revBindSites) {
      // 正向引物在 5'端，反向引物在 3'端
      // 产物从 fwdSite.start 到 revSite.end
      if (revSite.end <= fwdSite.start) continue
      
      const productLength = revSite.end - fwdSite.start
      if (productLength > maxProductLength || productLength < 50) continue
      
      // 判断是否为目标产物
      const startDiff = Math.abs(fwdSite.start - expectedStart)
      const endDiff = Math.abs(revSite.end - expectedEnd)
      const isExpected = startDiff <= 50 && endDiff <= 50 // 允许 ±50bp 偏差
      
      products.push({
        start: fwdSite.start,
        end: revSite.end,
        length: productLength,
        fwdMismatches: fwdSite.mismatches,
        revMismatches: revSite.mismatches,
        isExpected,
        fwdBindPos: fwdSite.start,
        revBindPos: revSite.start
      })
      
      // 限制产物数量
      if (products.length > 50) {
        products.sort((a, b) => {
          if (a.isExpected !== b.isExpected) return a.isExpected ? -1 : 1
          return a.length - b.length
        })
        return buildResult(products, expectedStart, expectedEnd)
      }
    }
  }
  
  // 按优先级排序：目标产物优先，长度从小到大
  products.sort((a, b) => {
    if (a.isExpected !== b.isExpected) return a.isExpected ? -1 : 1
    return a.length - b.length
  })
  
  return buildResult(products, expectedStart, expectedEnd)
}

function buildResult(
  products: PcrProduct[],
  expectedStart: number,
  expectedEnd: number
): InSilicoPcrResult {
  const expectedProducts = products.filter(p => p.isExpected)
  const unexpectedProducts = products.filter(p => !p.isExpected)
  
  return {
    products: products.slice(0, 20),
    isSpecific: unexpectedProducts.length === 0 && expectedProducts.length > 0,
    expectedProductCount: expectedProducts.length,
    unexpectedProductCount: unexpectedProducts.length,
    expectedLengthRange: expectedProducts.length > 0 ? {
      min: Math.min(...expectedProducts.map(p => p.length)),
      max: Math.max(...expectedProducts.map(p => p.length))
    } : undefined
  }
}

interface BindingSite {
  start: number
  end: number
  mismatches: number
}

/**
 * 查找引物在模板上的结合位点
 */
function findBindingSites(
  primer: string,
  template: string,
  maxMismatches: number
): BindingSite[] {
  const sites: BindingSite[] = []
  const pLen = primer.length
  const tLen = template.length
  
  // 使用 3'端 seed 快速过滤
  const seedLen = Math.min(8, Math.floor(pLen / 2))
  const seed = primer.substring(pLen - seedLen) // 3'端 seed
  
  for (let pos = 0; pos <= tLen - pLen; pos++) {
    // 快速 seed 过滤（3'端 seed）
    let seedMatches = 0
    for (let i = 0; i < seedLen; i++) {
      const primerIdx = pLen - seedLen + i
      const templIdx = pos + primerIdx
      if (templIdx < tLen && primer[primerIdx] === template[templIdx]) {
        seedMatches++
      }
    }
    
    if (seedMatches < seedLen - 1) continue
    
    // 完整比对
    let mismatches = 0
    let mismatchIn3PrimeEnd = false
    const threePrimeStart = pLen - 5
    
    for (let i = 0; i < pLen; i++) {
      if (pos + i >= tLen || primer[i] !== template[pos + i]) {
        mismatches++
        if (i >= threePrimeStart) {
          mismatchIn3PrimeEnd = true
          break
        }
        if (mismatches > maxMismatches) break
      }
    }
    
    if (mismatchIn3PrimeEnd || mismatches > maxMismatches) continue
    
    sites.push({
      start: pos,
      end: pos + pLen,
      mismatches
    })
    
    // 限制结合位点数量
    if (sites.length > 20) break
  }
  
  return sites
}

function reverseComplement(seq: string): string {
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }
  return seq.split('').reverse().map(c => comp[c] || c).join('')
}
