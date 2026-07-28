import { create } from 'zustand'

export interface TaskInfo {
  id: string
  label: string
  progress?: number // 0-100, undefined = indeterminate
  cancellable?: boolean
}

export interface ErrorLogEntry {
  id: string
  timestamp: number
  module: string
  message: string
  detail?: string
  stack?: string
}

// ============ 任务列表 store（低频更新：增删任务） ============

interface TaskListStore {
  tasks: TaskInfo[]
  addTask: (task: TaskInfo) => void
  removeTask: (id: string) => void
}

/**
 * 任务列表 store — 管理任务的增删（低频操作）
 * 进度更新由 useTaskProgressStore 单独管理，避免高频更新触发所有任务订阅者重渲染
 */
export const useTaskListStore = create<TaskListStore>((set) => ({
  tasks: [],

  addTask: (task) =>
    set((state) => ({ tasks: [...state.tasks, task] })),

  removeTask: (id) => {
    // 同步清理进度 store 中的对应条目
    useTaskProgressStore.getState().removeProgress(id)
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }))
  },
}))

// ============ 任务进度 store（高频更新：进度百分比、状态变化） ============

interface TaskProgressStore {
  /** 进度快照 Map：taskId → progress (0-100 | undefined) */
  progressMap: Record<string, number | undefined>
  updateProgress: (id: string, progress: number | undefined) => void
  removeProgress: (id: string) => void
  clearAll: () => void
}

/**
 * 任务进度 store — 管理高频进度更新
 * 与 useTaskListStore 分离后，进度条组件只需订阅此 store，
 * 不会因任务列表增删而重渲染；反之亦然
 */
export const useTaskProgressStore = create<TaskProgressStore>((set) => ({
  progressMap: {},

  updateProgress: (id, progress) =>
    set((state) => {
      // 值未变则不触发更新
      if (state.progressMap[id] === progress) return state
      return { progressMap: { ...state.progressMap, [id]: progress } }
    }),

  removeProgress: (id) =>
    set((state) => {
      if (!(id in state.progressMap)) return state
      const next = { ...state.progressMap }
      delete next[id]
      return { progressMap: next }
    }),

  clearAll: () => set({ progressMap: {} }),
}))

// ============ 错误日志 store（低频更新） ============

interface TaskErrorStore {
  errorLog: ErrorLogEntry[]
  addErrorLog: (entry: Omit<ErrorLogEntry, 'id' | 'timestamp'>) => void
  clearErrorLog: () => void
  /** 从 Worker 返回的错误自动记录 */
  logWorkerError: (module: string, error: any) => void
}

let errorIdCounter = 0

/**
 * 错误日志 store — 管理全局错误日志
 */
export const useTaskErrorStore = create<TaskErrorStore>((set) => ({
  errorLog: [],

  addErrorLog: (entry) =>
    set((state) => {
      const newEntry: ErrorLogEntry = {
        ...entry,
        id: `err-${++errorIdCounter}-${Date.now()}`,
        timestamp: Date.now(),
      }
      const newLog = [...state.errorLog, newEntry]
      return { errorLog: newLog.length > 200 ? newLog.slice(-200) : newLog }
    }),

  clearErrorLog: () => set({ errorLog: [] }),

  logWorkerError: (module, error) => {
    const msg = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    set((state) => {
      const newEntry: ErrorLogEntry = {
        id: `err-${++errorIdCounter}-${Date.now()}`,
        timestamp: Date.now(),
        module,
        message: msg,
        stack,
      }
      const newLog = [...state.errorLog, newEntry]
      return { errorLog: newLog.length > 200 ? newLog.slice(-200) : newLog }
    })
  },
}))

// ============ 兼容层 ============

/**
 * @deprecated 请直接使用 useTaskListStore / useTaskProgressStore / useTaskErrorStore
 */
export const useTaskStore = useTaskListStore

/**
 * 合并任务列表与进度，供需要完整 TaskInfo[] 的组件使用
 */
export function useMergedTasks(): TaskInfo[] {
  const tasks = useTaskListStore((s) => s.tasks)
  const progressMap = useTaskProgressStore((s) => s.progressMap)

  return tasks.map((t) => ({
    ...t,
    progress: t.id in progressMap ? progressMap[t.id] : t.progress,
  }))
}
