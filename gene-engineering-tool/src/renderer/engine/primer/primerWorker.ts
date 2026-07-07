/**
 * 引物设计 Web Worker
 */

import { designPrimers } from './primerDesigner'
import type { PrimerDesignMode, PrimerDesignParams, PrimerDesignResult } from './types'

interface DesignRequest {
  id: string
  templateSeq: string
  selectionStart: number
  selectionEnd: number
  mode: PrimerDesignMode
  params?: Partial<PrimerDesignParams>
}

interface DesignResponse {
  id: string
  result?: PrimerDesignResult
  error?: string
}

self.onmessage = (e: MessageEvent<DesignRequest>) => {
  const { id, templateSeq, selectionStart, selectionEnd, mode, params } = e.data
  try {
    const result = designPrimers(templateSeq, selectionStart, selectionEnd, mode, params)
    self.postMessage({ id, result } as DesignResponse)
  } catch (err: any) {
    self.postMessage({ id, error: err.message || 'Primer design failed' } as DesignResponse)
  }
}
