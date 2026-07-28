/**
 * @module hooks/useSmartAnnotation
 * @description
 * 智能标注共享 Hook — 封装载体元件智能标注的核心调用逻辑 (全序列扫描版本)。
 *
 * **新架构**：不再依赖现有 features，直接用载体全序列扫描元件数据库。
 *
 * 架构设计意图：
 * - 统一 VectorPage 和 VectorEditorPage 两处的智能标注入口
 * - 采用 Worker 化架构：主进程获取元件库快照 → Worker 执行全序列扫描
 * - 主进程不再阻塞（原 3-60 秒同步计算迁移到 Worker 线程）
 * - 各页面保留自己的结果处理差异（分类推断 vs feature 更新）
 *
 * 数据流向：
 * 1. IPC: getComponentSnapshot() → 主进程查询 DB 返回元件快照
 * 2. Worker: smart-annotate(snapshot, vectorSequence) → 全序列扫描匹配
 * 3. 渲染进程接收 SmartMatchResult[]（feature_index 均为 -1） → 各页面自行后处理
 *
 * 接口：
 * ```ts
 * const { annotate, annotateSequence, status, matches, error, progress, reset, isAnnotating } = useSmartAnnotation()
 * ```
 *
 * 依赖关系：
 * - window.api: IPC 调用 (getComponentSnapshot)
 * - workerRegistry: Worker 池管理
 * - workers/component-annotation.worker.ts: 标注计算 Worker
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { SmartMatchResult } from '../../shared/types'
import type { ComponentSnapshotItem } from '../engine/componentAnnotation'
import { workerRegistry } from '../workers/workerRegistry'
import { useTaskListStore, useTaskProgressStore } from '../stores/taskStore'

export type SmartAnnotationStatus = 'idle' | 'running' | 'done' | 'error'

export interface SmartAnnotationProgress {
  percent: number
  message: string
}

export interface UseSmartAnnotationReturn {
  /** 从 DB 获取载体序列后执行标注。返回匹配结果 */
  annotate: (vectorId: number) => Promise<SmartMatchResult[] | null>
  /** 直接用载体序列执行标注。返回匹配结果 */
  annotateSequence: (vectorSequence: string) => Promise<SmartMatchResult[] | null>
  /** 当前状态 */
  status: SmartAnnotationStatus
  /** 匹配结果（done 时有值，feature_index 均为 -1） */
  matches: SmartMatchResult[] | null
  /** 错误信息 */
  error: string
  /** 是否正在标注 */
  isAnnotating: boolean
  /** 进度信息 */
  progress: SmartAnnotationProgress | null
  /** 重置到初始状态 */
  reset: () => void
}

const WORKER_NAME = 'component-annotation'

/** 确保 Worker 已注册（惰性初始化） */
function ensureWorker(): void {
  workerRegistry.getWorker(WORKER_NAME, () =>
    new Worker(
      new URL('../workers/component-annotation.worker.ts', import.meta.url),
      { type: 'module' }
    )
  )
}

/** 智能标注共享 Hook (全序列扫描版本) */
export function useSmartAnnotation(): UseSmartAnnotationReturn {
  const [status, setStatus] = useState<SmartAnnotationStatus>('idle')
  const [matches, setMatches] = useState<SmartMatchResult[] | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<SmartAnnotationProgress | null>(null)

  // RAF 节流进度更新
  const progressRafRef = useRef<number>(0)
  const pendingProgressRef = useRef<SmartAnnotationProgress | null>(null)
  const workerActiveRef = useRef(false)

  const flushProgress = useCallback(() => {
    if (pendingProgressRef.current) {
      setProgress(pendingProgressRef.current)
      pendingProgressRef.current = null
    }
    progressRafRef.current = 0
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
    setMatches(null)
    setError('')
    setProgress(null)
  }, [])

  /** 核心标注流程：获取快照 → Worker 全序列扫描 → matches。返回结果供调用方直接使用 */
  const runAnnotation = useCallback(async (vectorSequence: string): Promise<SmartMatchResult[] | null> => {
    if (!vectorSequence) {
      setError('载体无序列数据，无法执行智能标注')
      setStatus('error')
      return null
    }

    // 注册全局任务（顶部进度条自动显示）
    const taskId = `smart-annotate-${Date.now()}`
    useTaskListStore.getState().addTask({
      id: taskId,
      label: '智能标注元件',
      progress: 0,
      cancellable: true,
    })

    setStatus('running')
    setMatches(null)
    setError('')
    setProgress(null)

    try {
      // Step 1: 主进程获取元件库快照（快速 DB 查询，~5-20ms）
      setProgress({ percent: 5, message: '加载元件库...' })
      useTaskProgressStore.getState().updateProgress(taskId, 5)
      const snapshot = await window.api.getComponentSnapshot() as {
        components: ComponentSnapshotItem[]
        allComponents: ComponentSnapshotItem[]
      }

      if (!snapshot || !snapshot.components) {
        throw new Error('获取元件库快照失败')
      }

      // Step 2: Worker 执行全序列扫描匹配
      ensureWorker()
      workerActiveRef.current = true

      const result = await workerRegistry.execute<any, SmartMatchResult[]>(
        WORKER_NAME,
        'smart-annotate',
        {
          components: snapshot.components,
          allComponents: snapshot.allComponents,
          vectorSequence,
        },
        {
          priority: 'high',
          onProgress: (percent, message) => {
            pendingProgressRef.current = { percent, message }
            // 同步更新全局任务进度（顶部进度条）
            useTaskProgressStore.getState().updateProgress(taskId, percent)
            if (!progressRafRef.current) {
              progressRafRef.current = requestAnimationFrame(flushProgress)
            }
          },
        }
      )

      workerActiveRef.current = false
      setMatches(result || [])
      setStatus('done')
      setProgress(null)
      // 移除全局任务（进度条自动消失）
      useTaskListStore.getState().removeTask(taskId)
      return result || []
    } catch (e: any) {
      workerActiveRef.current = false
      // 移除全局任务
      useTaskListStore.getState().removeTask(taskId)
      if (e.message === 'Task cancelled') {
        setStatus('idle')
        return null
      }
      setError(e.message || '智能标注失败')
      setStatus('error')
      setProgress(null)
      return null
    }
  }, [flushProgress])

  /** 从 DB 获取载体序列后执行标注（VectorPage / VectorEditorPage 场景）。返回匹配结果 */
  const annotate = useCallback(async (vectorId: number): Promise<SmartMatchResult[] | null> => {
    try {
      const editorData = await window.api.getEditorData(vectorId)
      const sequence = (editorData as any)?.vector?.sequence || ''
      return await runAnnotation(sequence)
    } catch (e: any) {
      setError(e.message || '获取载体数据失败')
      setStatus('error')
      return null
    }
  }, [runAnnotation])

  /** 直接用载体序列执行标注（不依赖 features）。返回匹配结果 */
  const annotateSequence = useCallback(async (vectorSequence: string): Promise<SmartMatchResult[] | null> => {
    return await runAnnotation(vectorSequence)
  }, [runAnnotation])

  // 组件卸载时清理 Worker
  useEffect(() => {
    return () => {
      workerRegistry.terminate(WORKER_NAME)
      if (progressRafRef.current) {
        cancelAnimationFrame(progressRafRef.current)
      }
    }
  }, [])

  return {
    annotate,
    annotateSequence,
    status,
    matches,
    error,
    isAnnotating: status === 'running',
    progress,
    reset,
  }
}
