/**
 * 序列比对 React Hook
 * 管理 Worker 生命周期，支持取消
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import type { AlignmentType, AlignmentParams, AlignmentOutput } from '../engine/alignment/types'

export type AlignmentStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

export function useAlignment() {
  const [status, setStatus] = useState<AlignmentStatus>('idle')
  const [result, setResult] = useState<AlignmentOutput | null>(null)
  const [error, setError] = useState<string>('')
  const workerRef = useRef<Worker | null>(null)
  const idRef = useRef(0)

  const align = useCallback((
    seq1: string,
    seq2: string,
    type: AlignmentType,
    params?: Partial<AlignmentParams>,
    seq1Name?: string,
    seq2Name?: string
  ) => {
    // 取消之前的 worker
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }

    setStatus('running')
    setResult(null)
    setError('')

    const worker = new Worker(
      new URL('../engine/alignment/alignmentWorker.ts', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker

    const id = String(++idRef.current)

    worker.onmessage = (e) => {
      const data = e.data
      if (data.id !== id) return
      if (data.error) {
        setError(data.error)
        setStatus('error')
      } else {
        setResult(data.output)
        setStatus('done')
      }
      worker.terminate()
      workerRef.current = null
    }

    worker.onerror = (e) => {
      setError(e.message || 'Worker error')
      setStatus('error')
      worker.terminate()
      workerRef.current = null
    }

    worker.postMessage({ id, seq1, seq2, type, params, seq1Name, seq2Name })
  }, [])

  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    setStatus('cancelled')
  }, [])

  const reset = useCallback(() => {
    cancel()
    setStatus('idle')
    setResult(null)
    setError('')
  }, [cancel])

  // 清理
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
      }
    }
  }, [])

  return { align, cancel, reset, status, result, error }
}
