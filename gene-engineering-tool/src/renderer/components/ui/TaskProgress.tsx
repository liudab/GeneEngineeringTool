import { useRef, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { useTaskProgressStore, type TaskInfo } from '../../stores/taskStore'

interface Props {
  tasks: TaskInfo[]
  onCancel?: (id: string) => void
}

/**
 * 后台任务进度条
 * 固定在页面顶部的细条进度指示器
 * 支持确定性进度和脉冲动画（不确定性任务）
 *
 * 性能优化：
 * - 任务列表（低频）与进度（高频）分别订阅不同 store
 * - 进度条宽度通过 useRef + requestAnimationFrame 直接操作 DOM，
 *   避免每次进度变化都触发 React 重渲染
 */
export default function TaskProgress({ tasks, onCancel }: Props) {
  const progressMap = useTaskProgressStore((s) => s.progressMap)
  const barsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const labelsRef = useRef<Map<string, HTMLSpanElement>>(new Map())
  const rafIdRef = useRef<number>(0)
  const pendingRef = useRef<Map<string, number | undefined>>(new Map())

  // 收集待更新的进度值，通过 RAF 批量更新 DOM
  const flushDOM = useCallback(() => {
    if (pendingRef.current.size === 0) return
    pendingRef.current.forEach((progress, id) => {
      const bar = barsRef.current.get(id)
      const label = labelsRef.current.get(id)
      if (bar && progress != null) {
        bar.style.width = `${Math.min(100, Math.max(0, progress))}%`
      }
      if (label && progress != null) {
        label.textContent = `${Math.round(progress)}%`
      }
    })
    pendingRef.current.clear()
  }, [])

  // 当 progressMap 变化时，调度 RAF 批量更新
  useEffect(() => {
    for (const [id, progress] of Object.entries(progressMap)) {
      pendingRef.current.set(id, progress)
    }
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = 0
        flushDOM()
      })
    }
  }, [progressMap, flushDOM])

  // 清理 RAF
  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  const setBarRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) barsRef.current.set(id, el)
    else barsRef.current.delete(id)
  }, [])

  const setLabelRef = useCallback((id: string, el: HTMLSpanElement | null) => {
    if (el) labelsRef.current.set(id, el)
    else labelsRef.current.delete(id)
  }, [])

  if (tasks.length === 0) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[99998] flex flex-col">
      {tasks.map(task => {
        const progress = task.id in progressMap ? progressMap[task.id] : task.progress
        return (
          <div key={task.id} className="relative h-1 bg-slate-200">
            {progress != null ? (
              <div
                ref={(el) => setBarRef(task.id, el)}
                className="absolute left-0 top-0 h-full bg-blue-500 transition-[width] duration-200 ease-linear"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            ) : (
              <div className="absolute left-0 top-0 h-full w-full overflow-hidden">
                <div
                  className="absolute h-full bg-blue-500 opacity-80 animate-[task-pulse_1.5s_ease-in-out_infinite]"
                  style={{ width: '30%' }}
                />
              </div>
            )}
            <div className="absolute right-2 -bottom-5 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded px-1.5 py-0.5 shadow-sm border border-slate-100">
              <span className="text-[9px] text-slate-500">{task.label}</span>
              {progress != null && (
                <span
                  ref={(el) => setLabelRef(task.id, el)}
                  className="text-[9px] text-blue-500 font-medium"
                >
                  {Math.round(progress)}%
                </span>
              )}
              {task.cancellable && onCancel && (
                <button onClick={() => onCancel(task.id)} className="p-0.5 text-slate-400 hover:text-red-500">
                  <X size={10} />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export type { TaskInfo }
