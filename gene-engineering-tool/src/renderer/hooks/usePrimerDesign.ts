/**
 * 引物设计 React Hook
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import type { PrimerDesignMode, PrimerDesignParams, PrimerDesignResult, DesignedPrimer } from '../engine/primer/types'

export type DesignStatus = 'idle' | 'running' | 'done' | 'error'

export function usePrimerDesign() {
  const [status, setStatus] = useState<DesignStatus>('idle')
  const [result, setResult] = useState<PrimerDesignResult | null>(null)
  const [error, setError] = useState<string>('')
  const [selectedPair, setSelectedPair] = useState<DesignedPrimer | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const idRef = useRef(0)

  const design = useCallback((
    templateSeq: string,
    selectionStart: number,
    selectionEnd: number,
    mode: PrimerDesignMode,
    params?: Partial<PrimerDesignParams>
  ) => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }

    setStatus('running')
    setResult(null)
    setSelectedPair(null)
    setError('')

    const worker = new Worker(
      new URL('../engine/primer/primerWorker.ts', import.meta.url),
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
        setResult(data.result)
        setStatus('done')
        // 默认选中第一个（最高分）
        if (data.result?.pairs?.length > 0) {
          setSelectedPair(data.result.pairs[0])
        }
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

    worker.postMessage({ id, templateSeq, selectionStart, selectionEnd, mode, params })
  }, [])

  const reset = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    setStatus('idle')
    setResult(null)
    setSelectedPair(null)
    setError('')
  }, [])

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
      }
    }
  }, [])

  return { design, reset, status, result, error, selectedPair, setSelectedPair }
}
