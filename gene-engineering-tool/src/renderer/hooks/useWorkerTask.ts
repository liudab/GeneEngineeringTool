/**
 * @module hooks/useWorkerTask
 * @description
 * 通用 Worker 任务 Hook — 抽象 usePrimerDesign 和 useAlignment 的共性模式。
 *
 * 架构设计意图：
 * - 消除各 Worker Hook 中的重复代码（ensureWorker → execute → RAF进度 → cancel → cleanup）
 * - 提供统一的接口和状态管理模式
 * - 内置 RAF 节流进度更新、组件卸载时自动清理
 *
 * 通用模式：
 * 1. 惰性初始化 Worker（首次 execute 时创建）
 * 2. 提交任务 → 等待结果 → 更新状态
 * 3. 进度通过 RAF 节流更新（避免高频 setState）
 * 4. 支持取消正在运行的任务
 * 5. 组件卸载时自动终止 Worker 和 RAF
 *
 * 接口规范：
 * ```ts
 * const { execute, cancel, reset, status, result, error, progress } = useWorkerTask<TInput, TOutput>(
 *   workerName: string,
 *   workerFactory: () => Worker
 * )
 * ```
 *
 * 依赖关系：
 * - workerRegistry: Worker 池管理
 * - React hooks: useState, useRef, useCallback, useEffect
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { workerRegistry } from '../workers/workerRegistry'

// ─── 类型定义 ──────────────────────────────────────────

export type WorkerTaskStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

export interface WorkerTaskProgress {
  percent: number
  message: string
}

export interface WorkerTaskOptions {
  /** 任务优先级（默认 'high'） */
  priority?: 'high' | 'normal' | 'low'
  /** 超时毫秒数（默认无超时） */
  timeout?: number
}

export interface UseWorkerTaskReturn<TOutput> {
  /** 提交并执行任务 */
  execute: (taskType: string, input: any, options?: WorkerTaskOptions) => void
  /** 取消当前正在运行的任务 */
  cancel: () => void
  /** 重置状态到 idle（同时取消运行中的任务） */
  reset: () => void
  /** 当前任务状态 */
  status: WorkerTaskStatus
  /** 任务结果（成功时有值） */
  result: TOutput | null
  /** 错误信息（失败时有值） */
  error: string
  /** 进度信息（运行中有值） */
  progress: WorkerTaskProgress | null
}

// ─── Hook 实现 ──────────────────────────────────────────

/**
 * 通用 Worker 任务 Hook
 * @param workerName Worker 在 Registry 中的名称
 * @param workerFactory 创建 Worker 实例的工厂函数
 */
export function useWorkerTask<TOutput = any>(
  workerName: string,
  workerFactory: () => Worker
): UseWorkerTaskReturn<TOutput> {
  const [status, setStatus] = useState<WorkerTaskStatus>('idle')
  const [result, setResult] = useState<TOutput | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<WorkerTaskProgress | null>(null)

  const workerActiveRef = useRef(false)
  const progressRafRef = useRef<number>(0)
  const pendingProgressRef = useRef<WorkerTaskProgress | null>(null)

  /** 将挂起的进度更新 flush 到 state（RAF 回调） */
  const flushProgress = useCallback(() => {
    if (pendingProgressRef.current) {
      setProgress(pendingProgressRef.current)
      pendingProgressRef.current = null
    }
    progressRafRef.current = 0
  }, [])

  /** 确保 Worker 已注册（惰性初始化） */
  const ensureWorker = useCallback(() => {
    workerRegistry.getWorker(workerName, workerFactory)
  }, [workerName, workerFactory])

  /** 取消当前正在运行的任务 */
  const cancelRunning = useCallback(() => {
    if (workerActiveRef.current) {
      const runningId = workerRegistry.getRunningTask(workerName)
      if (runningId) workerRegistry.cancel(runningId)
      workerActiveRef.current = false
    }
    if (progressRafRef.current) {
      cancelAnimationFrame(progressRafRef.current)
      progressRafRef.current = 0
    }
    pendingProgressRef.current = null
  }, [workerName])

  /** 提交并执行任务 */
  const execute = useCallback((
    taskType: string,
    input: any,
    options?: WorkerTaskOptions
  ) => {
    cancelRunning()
    ensureWorker()

    setStatus('running')
    setResult(null)
    setError('')
    setProgress(null)
    workerActiveRef.current = true

    workerRegistry
      .execute<any, TOutput>(workerName, taskType, input, {
        priority: options?.priority ?? 'high',
        timeout: options?.timeout,
        onProgress: (percent, message) => {
          pendingProgressRef.current = { percent, message }
          if (!progressRafRef.current) {
            progressRafRef.current = requestAnimationFrame(flushProgress)
          }
        }
      })
      .then((res) => {
        workerActiveRef.current = false
        setResult(res)
        setStatus('done')
        setProgress(null)
      })
      .catch((err: Error) => {
        workerActiveRef.current = false
        if (err.message === 'Task cancelled' || err.message === 'DESIGN_CANCELLED') {
          setStatus('cancelled')
        } else {
          setError(err.message || '任务执行失败')
          setStatus('error')
        }
        setProgress(null)
      })
  }, [workerName, cancelRunning, ensureWorker, flushProgress])

  /** 取消任务 */
  const cancel = useCallback(() => {
    cancelRunning()
    setStatus('cancelled')
    setProgress(null)
  }, [cancelRunning])

  /** 重置到初始状态 */
  const reset = useCallback(() => {
    cancelRunning()
    setStatus('idle')
    setResult(null)
    setError('')
    setProgress(null)
  }, [cancelRunning])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      workerRegistry.terminate(workerName)
      if (progressRafRef.current) {
        cancelAnimationFrame(progressRafRef.current)
      }
    }
  }, [workerName])

  return { execute, cancel, reset, status, result, error, progress }
}
