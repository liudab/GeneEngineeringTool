/**
 * @module hooks/usePrimerDesign
 * @description
 * 引物设计 React Hook — 通过 WorkerRegistry 调用引物设计 Worker。
 *
 * 架构设计意图：
 * - 封装 primer-design.worker.ts 的调用逻辑
 * - 支持进度回调（RAF 节流）、取消和状态管理
 * - 组件卸载时自动终止 Worker
 *
 * 接口：
 * ```ts
 * const { design, cancel, reset, status, result, error, selectedPair, setSelectedPair, progress } = usePrimerDesign()
 * ```
 *
 * 依赖关系：
 * - workerRegistry: Worker 池管理
 * - workers/primer-design.worker.ts: 引物设计计算引擎
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import type { PrimerDesignMode, PrimerDesignParams, PrimerDesignResult, DesignedPrimer } from '../engine/primer/types'
import { workerRegistry } from '../workers/workerRegistry'

export type DesignStatus = 'idle' | 'running' | 'done' | 'error'

export interface DesignProgress {
  percent: number
  message: string
}

const WORKER_NAME = 'primer-design'

/** 确保 Worker 已注册（惰性初始化单例） */
function ensureWorker(): void {
  workerRegistry.getWorker(
    WORKER_NAME,
    () => new Worker(new URL('../workers/primer-design.worker.ts', import.meta.url), { type: 'module' })
  )
}

export function usePrimerDesign() {
  const [status, setStatus] = useState<DesignStatus>('idle')
  const [result, setResult] = useState<PrimerDesignResult | null>(null)
  const [error, setError] = useState<string>('')
  const [selectedPair, setSelectedPair] = useState<DesignedPrimer | null>(null)
  const [progress, setProgress] = useState<DesignProgress | null>(null)
  // 通过 getRunningTask 追踪当前任务 ID
  const workerActiveRef = useRef(false)
  // RAF 节流进度更新
  const progressRafRef = useRef<number>(0)
  const pendingProgressRef = useRef<DesignProgress | null>(null)

  const flushProgress = useCallback(() => {
    if (pendingProgressRef.current) {
      setProgress(pendingProgressRef.current)
      pendingProgressRef.current = null
    }
    progressRafRef.current = 0
  }, [])

  const design = useCallback((
    templateSeq: string,
    selectionStart: number,
    selectionEnd: number,
    mode: PrimerDesignMode,
    params?: Partial<PrimerDesignParams>
  ) => {
    // 取消上一次任务
    if (workerActiveRef.current) {
      const runningId = workerRegistry.getRunningTask(WORKER_NAME)
      if (runningId) workerRegistry.cancel(runningId)
      workerActiveRef.current = false
    }
    if (progressRafRef.current) {
      cancelAnimationFrame(progressRafRef.current)
      progressRafRef.current = 0
    }
    pendingProgressRef.current = null

    // 确保 Worker 已注册
    ensureWorker()

    setStatus('running')
    setResult(null)
    setSelectedPair(null)
    setError('')
    setProgress(null)
    workerActiveRef.current = true

    workerRegistry
      .execute<{ templateSeq: string; selectionStart: number; selectionEnd: number; mode: PrimerDesignMode; params?: Partial<PrimerDesignParams> }, PrimerDesignResult>(
        WORKER_NAME,
        'design',
        { templateSeq, selectionStart, selectionEnd, mode, params },
        {
          priority: 'high',
          onProgress: (percent, message) => {
            pendingProgressRef.current = { percent, message }
            if (!progressRafRef.current) {
              progressRafRef.current = requestAnimationFrame(flushProgress)
            }
          }
        }
      )
      .then((res) => {
        workerActiveRef.current = false
        setResult(res)
        setStatus('done')
        setProgress(null)
        if (res?.pairs?.length > 0) {
          setSelectedPair(res.pairs[0])
        }
      })
      .catch((err: Error) => {
        workerActiveRef.current = false
        if (err.message === 'Task cancelled' || err.message === 'DESIGN_CANCELLED') {
          setStatus('idle')
          return
        }
        setError(err.message || '引物设计失败')
        setStatus('error')
      })
  }, [flushProgress])

  const cancel = useCallback(() => {
    if (workerActiveRef.current) {
      const runningId = workerRegistry.getRunningTask(WORKER_NAME)
      if (runningId) workerRegistry.cancel(runningId)
      workerActiveRef.current = false
    }
  }, [])

  const reset = useCallback(() => {
    if (workerActiveRef.current) {
      const runningId = workerRegistry.getRunningTask(WORKER_NAME)
      if (runningId) workerRegistry.cancel(runningId)
      workerActiveRef.current = false
    }
    if (progressRafRef.current) {
      cancelAnimationFrame(progressRafRef.current)
      progressRafRef.current = 0
    }
    setStatus('idle')
    setResult(null)
    setSelectedPair(null)
    setError('')
    setProgress(null)
  }, [])

  useEffect(() => {
    return () => {
      // 组件卸载时终止 Worker
      workerRegistry.terminate(WORKER_NAME)
      if (progressRafRef.current) {
        cancelAnimationFrame(progressRafRef.current)
      }
    }
  }, [])

  return { design, cancel, reset, status, result, error, selectedPair, setSelectedPair, progress }
}
