/**
 * @module hooks/useAlignment
 * @description
 * 序列比对 React Hook — 使用 workerRegistry 调用统一比对 Worker。
 *
 * 架构设计意图：
 * - 封装 alignment.worker.ts 的调用逻辑
 * - 指向新的 workers/alignment.worker.ts（替代旧版 engine/alignment/alignmentWorker.ts）
 * - 支持比对任务提交、取消和状态管理
 *
 * 依赖关系：
 * - workerRegistry: Worker 池管理
 * - workers/alignment.worker.ts: 比对计算引擎
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { workerRegistry } from '../workers/workerRegistry'
import type { AlignmentType, AlignmentParams, AlignmentOutput } from '../engine/alignment/types'

export type AlignmentStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

const WORKER_NAME = 'alignment'

/** 确保 alignment Worker 已注册（惰性初始化，指向新的 workers/ 目录） */
function ensureWorker(): void {
  workerRegistry.getWorker(WORKER_NAME, () =>
    new Worker(new URL('../workers/alignment.worker.ts', import.meta.url), { type: 'module' })
  )
}

export function useAlignment() {
  const [status, setStatus] = useState<AlignmentStatus>('idle')
  const [result, setResult] = useState<AlignmentOutput | null>(null)
  const [error, setError] = useState<string>('')
  const taskIdRef = useRef<string | null>(null)

  // 确保 Worker 已注册
  useEffect(() => {
    ensureWorker()
    return () => {
      // 组件卸载时取消正在运行的任务
      if (taskIdRef.current) {
        workerRegistry.cancel(taskIdRef.current)
        taskIdRef.current = null
      }
    }
  }, [])

  const align = useCallback((
    seq1: string,
    seq2: string,
    type: AlignmentType,
    params?: Partial<AlignmentParams>,
    seq1Name?: string,
    seq2Name?: string
  ) => {
    // 取消之前的任务
    if (taskIdRef.current) {
      workerRegistry.cancel(taskIdRef.current)
      taskIdRef.current = null
    }

    ensureWorker()
    setStatus('running')
    setResult(null)
    setError('')

    const input = { seq1, seq2, type, params, seq1Name, seq2Name }

    workerRegistry
      .execute<typeof input, AlignmentOutput>(WORKER_NAME, 'align', input, {
        priority: 'high'
      })
      .then((output) => {
        setResult(output)
        setStatus('done')
        taskIdRef.current = null
      })
      .catch((err: Error) => {
        if (err.message === 'Task cancelled') {
          setStatus('cancelled')
        } else {
          setError(err.message || '比对失败')
          setStatus('error')
        }
        taskIdRef.current = null
      })

    // 记录当前任务 id（用于取消）
    taskIdRef.current = workerRegistry.getRunningTask(WORKER_NAME)
  }, [])

  const cancel = useCallback(() => {
    if (taskIdRef.current) {
      workerRegistry.cancel(taskIdRef.current)
      taskIdRef.current = null
    }
    setStatus('cancelled')
  }, [])

  const reset = useCallback(() => {
    cancel()
    setStatus('idle')
    setResult(null)
    setError('')
  }, [cancel])

  return { align, cancel, reset, status, result, error }
}
