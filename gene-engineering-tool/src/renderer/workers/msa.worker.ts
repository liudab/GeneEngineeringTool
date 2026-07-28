/**
 * MSA (Multiple Sequence Alignment) Worker
 * 在 Worker 中运行 ClustalW 多序列比对，支持进度上报和取消
 */

import { setupWorkerHandler } from './workerHelpers'
import { clustalW, type MSAInput } from '../engine/alignment/clustalW'
import type { AlignmentParams } from '../engine/alignment/types'
import type { TreeMethod } from '../engine/alignment/clustalW'

interface MSAWorkerInput {
  sequences: MSAInput[]
  isProtein?: boolean
  params?: Partial<AlignmentParams>
  treeMethod?: TreeMethod
}

setupWorkerHandler({
  /**
   * 执行多序列比对
   * - 在 clustalW 的 4 个阶段之间自动上报进度
   * - 支持通过 AbortController 取消（Worker 中通过 self.close 实现）
   */
  async msa(input: MSAWorkerInput, reportProgress) {
    const { sequences, isProtein = false, params, treeMethod = 'upgma' } = input

    if (!sequences || sequences.length < 2) {
      throw new Error('MSA 需要至少 2 条序列')
    }

    // 执行 ClustalW 比对，传入进度回调
    const result = clustalW(
      sequences,
      isProtein,
      params,
      treeMethod,
      (percent, message) => {
        reportProgress(percent, message)
      }
    )

    return result
  }
})
