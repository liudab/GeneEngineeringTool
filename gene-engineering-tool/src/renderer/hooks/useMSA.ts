/**
 * MSA (Multiple Sequence Alignment) React Hook
 * 使用 workerRegistry 全局单例 Worker，支持进度、取消、重置
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { workerRegistry } from '../workers/workerRegistry'
import type { MSAOutput } from '../engine/alignment/clustalW'
import type { MSAInput } from '../engine/alignment/clustalW'
import type { AlignmentParams } from '../engine/alignment/types'
import type { TreeMethod } from '../engine/alignment/clustalW'

const WORKER_NAME = 'msa'

/** 确保 MSA Worker 已注册（惰性初始化） */
function ensureWorker(): void {
  workerRegistry.getWorker(WORKER_NAME, () =>
    new Worker(new URL('../workers/msa.worker.ts', import.meta.url), { type: 'module' })
  )
}

export interface MSAAlignInput {
  sequences: MSAInput[]
  isProtein?: boolean
  params?: Partial<AlignmentParams>
  treeMethod?: TreeMethod
}

export function useMSA() {
  const [result, setResult] = useState<MSAOutput | null>(null)
  const [progress, setProgress] = useState<{ percent: number; message: string }>({ percent: 0, message: '' })
  const [isRunning, setIsRunning] = useState(false)
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

  /** 触发多序列比对 */
  const align = useCallback((input: MSAAlignInput) => {
    // 取消之前的任务
    if (taskIdRef.current) {
      workerRegistry.cancel(taskIdRef.current)
      taskIdRef.current = null
    }

    ensureWorker()
    setIsRunning(true)
    setError('')
    setProgress({ percent: 0, message: '准备中...' })
    setResult(null)

    workerRegistry
      .execute<MSAAlignInput, MSAOutput>(WORKER_NAME, 'msa', input, {
        priority: 'high',
        onProgress: (percent, message) => {
          setProgress({ percent, message })
        }
      })
      .then((output) => {
        setResult(output)
        setIsRunning(false)
        taskIdRef.current = null
      })
      .catch((err: Error) => {
        if (err.message !== 'Task cancelled') {
          setError(err.message || '比对失败')
        }
        setIsRunning(false)
        taskIdRef.current = null
      })

    // 记录当前任务 id（用于取消）
    taskIdRef.current = workerRegistry.getRunningTask(WORKER_NAME)
  }, [])

  /** 取消正在运行的比对 */
  const cancel = useCallback(() => {
    if (taskIdRef.current) {
      workerRegistry.cancel(taskIdRef.current)
      taskIdRef.current = null
    }
    setIsRunning(false)
    setProgress({ percent: 0, message: '' })
  }, [])

  /** 重置所有状态 */
  const reset = useCallback(() => {
    cancel()
    setResult(null)
    setError('')
    setProgress({ percent: 0, message: '' })
  }, [cancel])

  return { result, progress, isRunning, align, cancel, reset, error }
}
