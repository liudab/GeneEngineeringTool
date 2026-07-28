/**
 * 引物特异性预检模块
 * 在模板序列上扫描非目标结合位点
 * 参考 Primer-BLAST 的特异性验证机制
 */

/** Off-target 结合位点信息 */
export interface OffTargetSite {
  /** 在模板上的位置 (0-based) */
  position: number
  /** 错配数 */
  mismatches: number
  /** 链方向 */
  strand: '+' | '-'
  /** 匹配序列 */
  matchSeq: string
}

/** 特异性检查结果 */
export interface SpecificityResult {
  /** off-target 结合位点数量 */
  offTargetCount: number
  /** off-target 位点列表 */
  offTargets: OffTargetSite[]
  /** 是否为特异性引物 */
  isSpecific: boolean
}

/**
 * 检查引物在模板上的特异性
 * @param primer 引物序列 (5'→3')
 * @param template 模板序列
 * @param targetStart 目标区域起始 (0-based)
 * @param targetEnd 目标区域结束 (0-based, inclusive)
 * @param maxMismatches 最大允许错配数 (default 1)
 * @param maxOffTargets 最大 off-target 数量 (default 3)
 */
export function checkSpecificity(
  primer: string,
  template: string,
  targetStart: number,
  targetEnd: number,
  maxMismatches: number = 1,
  maxOffTargets: number = 3
): SpecificityResult {
  const p = primer.toUpperCase()
  const t = template.toUpperCase()
  const pLen = p.length
  const tLen = t.length
  
  if (pLen < 8 || tLen < pLen) {
    return { offTargetCount: 0, offTargets: [], isSpecific: true }
  }
  
  const offTargets: OffTargetSite[] = []
  
  // 正向链扫描
  scanStrand(p, t, '+', targetStart, targetEnd, maxMismatches, offTargets)
  
  // 反向互补链扫描
  const rcPrimer = reverseComplement(p)
  scanStrand(rcPrimer, t, '-', targetStart, targetEnd, maxMismatches, offTargets)
  
  // 如果 off-target 数量超过阈值，提前返回
  if (offTargets.length > maxOffTargets * 2) {
    return {
      offTargetCount: offTargets.length,
      offTargets: offTargets.slice(0, maxOffTargets * 2),
      isSpecific: false
    }
  }
  
  return {
    offTargetCount: offTargets.length,
    offTargets,
    isSpecific: offTargets.length <= maxOffTargets
  }
}

/**
 * 扫描单条链上的匹配位点
 * 使用 seed-and-extend 策略优化性能
 */
function scanStrand(
  primer: string,
  template: string,
  strand: '+' | '-',
  targetStart: number,
  targetEnd: number,
  maxMismatches: number,
  offTargets: OffTargetSite[]
): void {
  const pLen = primer.length
  const tLen = template.length
  const seedLen = Math.min(8, Math.floor(pLen / 2))
  
  // 提取 primer 的 5'端 seed
  const seed = primer.substring(0, seedLen)
  
  for (let pos = 0; pos <= tLen - pLen; pos++) {
    // 快速 seed 过滤：检查前 seedLen 个碱基的匹配数
    let seedMatches = 0
    for (let i = 0; i < seedLen; i++) {
      if (pos + i < tLen && primer[i] === template[pos + i]) {
        seedMatches++
      }
    }
    
    // Seed 必须至少有 seedLen - 1 个匹配才继续检查
    if (seedMatches < seedLen - 1) continue
    
    // 完整比对
    let mismatches = 0
    let mismatchIn3PrimeEnd = false
    const threePrimeEnd = pLen - 3 // 3'端最后 3bp 不允许错配
    
    for (let i = 0; i < pLen; i++) {
      if (pos + i >= tLen || primer[i] !== template[pos + i]) {
        mismatches++
        // 3'端最后 5bp 不允许错配
        if (i >= threePrimeEnd) {
          mismatchIn3PrimeEnd = true
          break
        }
        if (mismatches > maxMismatches) break
      }
    }
    
    // 如果 3'端有错配或总错配超限，跳过
    if (mismatchIn3PrimeEnd || mismatches > maxMismatches) continue
    
    // 检查是否在目标区域内（如果是，则不是 off-target）
    const inTargetRegion = pos >= targetStart && (pos + pLen - 1) <= targetEnd
    if (inTargetRegion) continue
    
    // 记录 off-target
    offTargets.push({
      position: pos,
      mismatches,
      strand,
      matchSeq: template.substring(pos, pos + pLen)
    })
    
    // 限制收集数量
    if (offTargets.length > 20) return
  }
}

/**
 * 批量检查引物对的特异性
 * @param fwdPrimer 正向引物序列
 * @param revPrimer 反向引物序列
 * @param template 模板序列
 * @param targetStart 目标区域起始
 * @param targetEnd 目标区域结束
 * @param maxMismatches 最大错配数
 * @param maxOffTargets 最大 off-target 数
 */
export function checkPrimerPairSpecificity(
  fwdPrimer: string,
  revPrimer: string,
  template: string,
  targetStart: number,
  targetEnd: number,
  maxMismatches: number = 1,
  maxOffTargets: number = 3
): { fwd: SpecificityResult; rev: SpecificityResult; isPairSpecific: boolean } {
  const fwd = checkSpecificity(fwdPrimer, template, targetStart, targetEnd, maxMismatches, maxOffTargets)
  const rev = checkSpecificity(revPrimer, template, targetStart, targetEnd, maxMismatches, maxOffTargets)
  
  return {
    fwd,
    rev,
    isPairSpecific: fwd.isSpecific && rev.isSpecific
  }
}

function reverseComplement(seq: string): string {
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }
  return seq.split('').reverse().map(c => comp[c] || c).join('')
}
