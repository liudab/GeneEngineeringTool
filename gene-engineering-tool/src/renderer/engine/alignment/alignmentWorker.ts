/**
 * 比对 Web Worker
 * 避免长序列比对阻塞 UI 线程
 */

import { alignSequences } from './index'
import type { AlignmentType, AlignmentParams, AlignmentOutput } from './types'

interface AlignRequest {
  id: string
  seq1: string
  seq2: string
  type: AlignmentType
  params?: Partial<AlignmentParams>
  seq1Name?: string
  seq2Name?: string
}

interface AlignResponse {
  id: string
  output?: AlignmentOutput
  error?: string
}

self.onmessage = (e: MessageEvent<AlignRequest>) => {
  const { id, seq1, seq2, type, params, seq1Name, seq2Name } = e.data
  try {
    const output = alignSequences(seq1, seq2, type, params, seq1Name, seq2Name)
    self.postMessage({ id, output } as AlignResponse)
  } catch (err: any) {
    self.postMessage({ id, error: err.message || 'Alignment failed' } as AlignResponse)
  }
}
