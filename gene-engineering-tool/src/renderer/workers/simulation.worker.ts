/**
 * Simulation Worker
 * 在 Worker 中运行酶切模拟和凝胶电泳计算，避免阻塞主线程
 *
 * 支持的消息类型：
 * - digest: 酶切模拟（digestVector / calculateDigestFragments）
 * - gel: 凝胶电泳模拟（simulateGel / simulateMultiDigestGel）
 * - cloning: 克隆模拟（Golden Gate / TA / TOPO / Gateway / Gibson / InFusion / Mutagenesis）
 * - ligation: 连接模拟（ligate）
 * - methylation: 甲基化分析（findMethylationSites / checkMethylationBlock / annotateMethylation）
 */

import { setupWorkerHandler } from './workerHelpers'
import {
  digestVector,
  ligate,
  calculateDigestFragments,
  simulateGibson,
  simulateInFusion,
  type EnzymeDef,
  type CloneFragment
} from '../engine/cloning/cloningEngine'
import {
  simulateGoldenGate,
  simulateTACloning,
  simulateTOPOCloning,
  simulateGatewayBP,
  simulateGatewayLR,
  simulateMutagenesis
} from '../engine/cloning/extendedCloning'
import {
  findMethylationSites,
  checkMethylationBlock,
  annotateMethylation,
  type MethylationSite
} from '../engine/cloning/methylation'
import {
  simulateGel,
  simulateMultiDigestGel,
  fragmentsToLane,
  type GelLane,
  type GelConfig
} from '../engine/gel/electrophoresis'

// ─── 消息处理 ────────────────────────────────────────────────

setupWorkerHandler({
  /**
   * 酶切模拟
   * input: { mode: 'digest', vectorSeq: string, enzyme5: EnzymeDef, enzyme3: EnzymeDef }
   *     or { mode: 'fragments', sequence: string, enzymes: EnzymeDef[] }
   */
  async digest(input: {
    mode: 'digest' | 'fragments'
    vectorSeq?: string
    enzyme5?: EnzymeDef
    enzyme3?: EnzymeDef
    sequence?: string
    enzymes?: EnzymeDef[]
  }) {
    if (input.mode === 'digest' && input.vectorSeq && input.enzyme5 && input.enzyme3) {
      return digestVector(input.vectorSeq, input.enzyme5, input.enzyme3)
    }
    if (input.mode === 'fragments' && input.sequence && input.enzymes) {
      return calculateDigestFragments(input.sequence, input.enzymes)
    }
    throw new Error('Invalid digest input')
  },

  /**
   * 连接模拟
   * input: { vector, insert, vecOh5, vecOh3, insOh5, insOh3 }
   */
  async ligation(input: {
    vector: string
    insert: string
    vecOh5: string
    vecOh3: string
    insOh5: string
    insOh3: string
  }) {
    return ligate(input.vector, input.insert, input.vecOh5, input.vecOh3, input.insOh5, input.insOh3)
  },

  /**
   * 凝胶电泳模拟
   * input: { mode: 'lanes', lanes: GelLane[], config?: Partial<GelConfig> }
   *     or { mode: 'multi', digests: { name: string; fragments: { size: number }[] }[], config?: Partial<GelConfig> }
   *     or { mode: 'toLane', laneName: string, fragments: { size: number; label?: string }[] }
   */
  async gel(input: {
    mode: 'lanes' | 'multi' | 'toLane'
    lanes?: GelLane[]
    config?: Partial<GelConfig>
    digests?: { name: string; fragments: { size: number }[] }[]
    laneName?: string
    fragments?: { size: number; label?: string }[]
  }) {
    if (input.mode === 'lanes' && input.lanes) {
      return simulateGel(input.lanes, input.config)
    }
    if (input.mode === 'multi' && input.digests) {
      return simulateMultiDigestGel(input.digests, input.config)
    }
    if (input.mode === 'toLane' && input.laneName && input.fragments) {
      return fragmentsToLane(input.laneName, input.fragments)
    }
    throw new Error('Invalid gel input')
  },

  /**
   * 克隆模拟（扩展克隆方法）
   * 每种方法有各自的参数结构，详见下方 switch
   */
  async cloning(input: { method: string; [key: string]: any }) {
    const { method, ...params } = input
    switch (method) {
      case 'goldenGate':
        return simulateGoldenGate(params.fragments, params.enzyme)
      case 'ta':
        return simulateTACloning(params.insertSeq, params.vectorSeq)
      case 'topo':
        return simulateTOPOCloning(params.insertSeq, params.vectorSeq, params.type)
      case 'gatewayBP':
        return simulateGatewayBP(params.insertSeq, params.donorVector)
      case 'gatewayLR':
        return simulateGatewayLR(params.entryInsert, params.destinationVector)
      case 'gibson':
        return simulateGibson(params.fragments as CloneFragment[])
      case 'inFusion':
        return simulateInFusion(params.vector as string, params.insert as string, params.overlapLen as number | undefined)
      case 'mutagenesis':
        return simulateMutagenesis(params.templateSeq, params.position, params.mutation, params.type, params.deleteLength)
      default:
        throw new Error(`Unknown cloning method: ${method}`)
    }
  },

  /**
   * 甲基化分析
   * input: { mode: 'find', sequence: string }
   *     or { mode: 'check', enzymeRecognition: string, enzymeCutPos: number, sitePosition: number, sequence: string, methylationSites: MethylationSite[] }
   *     or { mode: 'annotate', sequence: string }
   */
  async methylation(input: {
    mode: 'find' | 'check' | 'annotate'
    sequence: string
    enzymeRecognition?: string
    enzymeCutPos?: number
    sitePosition?: number
    methylationSites?: MethylationSite[]
  }) {
    if (input.mode === 'find') {
      return findMethylationSites(input.sequence)
    }
    if (input.mode === 'check' && input.enzymeRecognition && input.enzymeCutPos !== undefined && input.sitePosition !== undefined && input.methylationSites) {
      return checkMethylationBlock(input.enzymeRecognition, input.enzymeCutPos, input.sitePosition, input.sequence, input.methylationSites)
    }
    if (input.mode === 'annotate') {
      return annotateMethylation(input.sequence)
    }
    throw new Error('Invalid methylation input')
  }
})
