/**
 * @module workers/primer-design.worker
 * @description
 * 引物设计 Web Worker — 在后台线程执行复杂引物设计计算，避免阻塞 UI。
 *
 * 架构设计意图：
 * - 将 CPU 密集的引物设计算法（候选枚举、热力学评分、特异性检查）隔离在 Worker 中
 * - 使用 setupWorkerHandler 统一消息分发协议
 * - 支持多轮迭代筛选、双漏斗诊断、实时进度上报和优雅取消
 *
 * 支持的任务类型：
 * - `design`: 执行完整引物设计流程（参数化配置 + 多轮迭代 + 评分排序）
 * - `cancel`: 设置取消标志，优雅终止当前设计任务
 *
 * 输入/输出规范：
 * - design 输入: { templateSeq, selectionStart, selectionEnd, mode, params? }
 *   - mode: 'amplify-region' | 'within-selection' | 'flanking-selection'
 *   - params: 50+ 参数（热力学、扩增子、配对兼容性、二级结构、特异性、12维权重等）
 * - design 输出: PrimerDesignResult
 *   - pairs: DesignedPrimer[]（按综合评分降序排列）
 *   - iterationCount: 迭代轮次
 *   - funnelData: 双漏斗诊断数据
 *   - failureReasons: 失败原因统计
 *
 * 核心算法流程：
 * 1. 候选引物枚举（长度/位置/Tm/GC 硬过滤）
 * 2. 热力学评分（ΔG hairpin/dimer, Tm 计算）
 * 3. 特异性检查（off-target 比对）
 * 4. 配对评分（12 维权重加权）
 * 5. 多轮迭代（动态调整参数直到找到合格引物对）
 *
 * 取消机制：
 * - 通过 volatile `cancelled` flag 在迭代间检查
 * - wrappedProgress 回调注入取消检查点
 * - cancel 任务类型设置 flag，下次 progress 回调时抛出 DESIGN_CANCELLED
 *
 * 依赖关系：
 * - workerHelpers: setupWorkerHandler 消息分发
 * - engine/primer/primerDesigner: designPrimersWithIterations 核心算法
 * - engine/primer/types: 类型定义
 */

import { setupWorkerHandler } from './workerHelpers'
import { designPrimersWithIterations } from '../engine/primer/primerDesigner'
import type { PrimerDesignMode, PrimerDesignParams, PrimerDesignResult } from '../engine/primer/types'

/** 取消标志：volatile flag checked between iterations */
let cancelled = false

interface DesignInput {
  templateSeq: string
  selectionStart: number
  selectionEnd: number
  mode: PrimerDesignMode
  params?: Partial<PrimerDesignParams>
}

setupWorkerHandler({
  /**
   * 执行完整引物设计流程
   */
  async design(input: DesignInput, reportProgress): Promise<PrimerDesignResult> {
    cancelled = false
    const { templateSeq, selectionStart, selectionEnd, mode, params } = input

    console.log(`[PrimerWorker] design: mode=${mode}, template=${templateSeq.length}bp`)

    reportProgress(5, '初始化引物设计引擎...')

    // 包装进度回调：注入取消检查
    const wrappedProgress = (percent: number, message: string): void => {
      if (cancelled) {
        throw new Error('DESIGN_CANCELLED')
      }
      reportProgress(percent, message)
    }

    const result = designPrimersWithIterations(
      templateSeq,
      selectionStart,
      selectionEnd,
      mode,
      params,
      wrappedProgress
    )

    if (cancelled) {
      throw new Error('DESIGN_CANCELLED')
    }

    reportProgress(95, `设计完成：${result.pairs.length} 对引物${result.iterationCount && result.iterationCount > 1 ? `（${result.iterationCount} 轮迭代）` : ''}`)
    reportProgress(100, '完成')

    console.log(`[PrimerWorker] design complete: ${result.pairs.length} pairs`)
    return result
  },

  /**
   * 取消当前设计任务
   */
  async cancel(): Promise<{ ok: true }> {
    cancelled = true
    console.log('[PrimerWorker] cancel requested')
    return { ok: true }
  }
})
