/**
 * @module workers/component-annotation.worker
 * @description
 * 元件标注 Web Worker - 在后台线程执行智能标注全序列扫描，避免阻塞主进程。
 *
 * 架构设计意图:
 * - 替代原主进程 IPC 直接调用 smartAnnotateComponents (访问 SQLite)
 * - 采用流程: 主进程 IPC 获取元件库快照 -> 快照数据传入 Worker -> 全序列扫描返回结果
 * - 使用 engine/componentAnnotation/index.ts 的 smartAnnotatePure()
 *
 * 支持的任务类型:
 * - smart-annotate: 智能标注 (输入载体序列 + 元件快照，不依赖 features)
 *
 * 输入/输出规范:
 * - smart-annotate 输入: { components, allComponents, vectorSequence }
 * - smart-annotate 输出: SmartMatchResult[]（feature_index 均为 -1）
 *
 * 依赖关系:
 * - workerHelpers: setupWorkerHandler
 * - engine/componentAnnotation: smartAnnotatePure, ComponentSnapshotItem
 */

import { setupWorkerHandler } from './workerHelpers'
import { smartAnnotatePure } from '../engine/componentAnnotation'
import type { ComponentSnapshotItem } from '../engine/componentAnnotation'
import type { SmartMatchResult } from '../../shared/types'

interface SmartAnnotateInput {
  components: ComponentSnapshotItem[]
  allComponents: ComponentSnapshotItem[]
  vectorSequence: string
}

setupWorkerHandler({
  /**
   * 智能标注元件
   * 接收元件快照 + 载体序列，返回 SmartMatchResult[]（不依赖 features）
   */
  async 'smart-annotate'(
    input: SmartAnnotateInput,
    reportProgress: (percent: number, message: string) => void
  ): Promise<SmartMatchResult[]> {
    console.log(`[AnnotateWorker] smart-annotate: components=${input.components.length}, allComponents=${input.allComponents.length}, seqLen=${input.vectorSequence.length}`)
    const result = smartAnnotatePure(
      input.vectorSequence,
      {
        components: input.components,
        allComponents: input.allComponents,
      },
      reportProgress
    )
    console.log(`[AnnotateWorker] smart-annotate result: ${result.length} matches`)
    return result
  },
})
