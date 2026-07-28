/**
 * @module workers/alignment.worker
 * @description
 * 统一序列比对 Web Worker — 在后台线程执行双序列比对，避免阻塞 UI。
 *
 * 架构设计意图：
 * - 替代旧版 engine/alignment/alignmentWorker.ts，统一放置在 workers/ 目录
 * - 使用 setupWorkerHandler 统一消息分发协议
 * - 支持多种比对类型，输出标准化的 AlignmentOutput 结构
 *
 * 支持的任务类型：
 * - `align`: 双序列比对（核酸NW/SW、蛋白质、核酸-蛋白六框翻译比对）
 * - `batch-align`: 批量比对（多对序列依次比对）
 * - `six-frame`: 仅六框翻译（不做比对，返回翻译结果）
 *
 * 输入/输出规范：
 * - align 输入: { seq1, seq2, type, params?, seq1Name?, seq2Name? }
 * - align 输出: AlignmentOutput { type, params, results[], translationFrame?, seq1Name?, seq2Name? }
 * - batch-align 输入: { pairs: Array<{seq1, seq2, type, params?, seq1Name?, seq2Name?}> }
 * - batch-align 输出: AlignmentOutput[]
 * - six-frame 输入: { sequence: string }
 * - six-frame 输出: TranslatedFrame[]
 *
 * 算法说明：
 * - nucleotide-nw: Needleman-Wunsch 全局比对
 * - nucleotide-sw: Smith-Waterman 局部比对（返回 top 5）
 * - protein: Needleman-Wunsch + BLOSUM62 蛋白比对
 * - nucleotide-protein: 核酸六框翻译后与蛋白序列做 Smith-Waterman 比对，选最佳帧
 *
 * 依赖关系：
 * - workerHelpers: setupWorkerHandler 消息分发
 * - engine/alignment: alignSequences, sixFrameTranslation 纯算法
 */

import { setupWorkerHandler } from './workerHelpers'
import { alignSequences, sixFrameTranslation } from '../engine/alignment'
import type { AlignmentType, AlignmentParams, AlignmentOutput, TranslatedFrame } from '../engine/alignment/types'

// ─── 任务输入类型 ──────────────────────────────────────────

interface AlignInput {
  seq1: string
  seq2: string
  type: AlignmentType
  params?: Partial<AlignmentParams>
  seq1Name?: string
  seq2Name?: string
}

interface BatchAlignInput {
  pairs: AlignInput[]
}

interface SixFrameInput {
  sequence: string
}

// ─── Worker 注册 ──────────────────────────────────────────

setupWorkerHandler({
  /**
   * 双序列比对：支持核酸-核酸（NW/SW）、蛋白质、核酸-蛋白质（六框翻译）
   */
  async align(input: AlignInput): Promise<AlignmentOutput> {
    return alignSequences(
      input.seq1,
      input.seq2,
      input.type,
      input.params,
      input.seq1Name,
      input.seq2Name
    )
  },

  /**
   * 批量比对：依次执行多对序列的比对，通过 reportProgress 上报进度
   */
  async 'batch-align'(input: BatchAlignInput, reportProgress): Promise<AlignmentOutput[]> {
    const results: AlignmentOutput[] = []
    const total = input.pairs.length
    for (let i = 0; i < total; i++) {
      const pair = input.pairs[i]
      const output = alignSequences(
        pair.seq1, pair.seq2, pair.type, pair.params, pair.seq1Name, pair.seq2Name
      )
      results.push(output)
      reportProgress(Math.round(((i + 1) / total) * 100), `比对 ${i + 1}/${total}`)
    }
    return results
  },

  /**
   * 六框翻译：对核酸序列执行正链3帧+反链3帧翻译，不做比对
   */
  async 'six-frame'(input: SixFrameInput): Promise<TranslatedFrame[]> {
    return sixFrameTranslation(input.sequence)
  }
})
