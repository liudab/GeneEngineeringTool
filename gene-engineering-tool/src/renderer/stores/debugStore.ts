/**
 * 诊断面板状态管理 store
 * 管理日志流、错误列表、系统状态、面板显隐
 */
import { create } from 'zustand'
import { type LogEntry, LogLevel, LOG_LEVEL_NAMES } from '../../shared/logger-types'
import { addLogListener } from '../utils/logger'
import { useTaskErrorStore, type ErrorLogEntry } from './taskStore'

interface DebugStore {
  /** 面板是否显示 */
  isOpen: boolean
  togglePanel: () => void
  setOpen: (open: boolean) => void

  /** 日志流（最近 500 条） */
  logs: LogEntry[]
  /** 错误日志（来自 taskStore） */
  errors: ErrorLogEntry[]

  /** 过滤 */
  levelFilter: LogLevel | null
  moduleFilter: string | null
  setLevelFilter: (level: LogLevel | null) => void
  setModuleFilter: (module: string | null) => void

  /** 系统状态 */
  systemStatus: {
    memoryUsage?: { heapUsed: number; heapTotal: number; rss: number }
    uptime?: number
    nodeVersion?: string
    electronVersion?: string
    platform?: string
    arch?: string
    logDir?: string
    recentLogCount?: number
  } | null
  refreshSystemStatus: () => Promise<void>

  /** 操作 */
  clearLogs: () => void
  exportLogs: () => Promise<void>
  openLogFolder: () => Promise<void>

  /** 初始化监听器 */
  init: () => void
}

let initialized = false

export const useDebugStore = create<DebugStore>((set, get) => ({
  isOpen: false,
  togglePanel: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (open) => set({ isOpen: open }),

  logs: [],
  errors: [],

  levelFilter: null,
  moduleFilter: null,
  setLevelFilter: (level) => set({ levelFilter: level }),
  setModuleFilter: (module) => set({ moduleFilter: module }),

  systemStatus: null,
  refreshSystemStatus: async () => {
    try {
      const status = await window.api.getSystemStatus()
      set({ systemStatus: status })
    } catch (err) {
      console.error('Failed to get system status', err)
    }
  },

  clearLogs: () => {
    if (window.__LOG_ENTRIES__) window.__LOG_ENTRIES__ = []
    set({ logs: [] })
    useTaskErrorStore.getState().clearErrorLog()
  },

  exportLogs: async () => {
    try {
      await window.api.exportDebugLogs()
    } catch (err) {
      console.error('Failed to export logs', err)
    }
  },

  openLogFolder: async () => {
    try {
      await window.api.openLogFolder()
    } catch (err) {
      console.error('Failed to open log folder', err)
    }
  },

  init: () => {
    if (initialized) return
    initialized = true

    // 监听新日志
    addLogListener((entry) => {
      set((s) => {
        const newLogs = [...s.logs, entry]
        return { logs: newLogs.length > 500 ? newLogs.slice(-500) : newLogs }
      })
    })

    // 定时同步 taskErrorStore 的错误日志（仅在内容变化时更新，避免每2秒触发重渲染）
    let prevErrorLen = 0
    let prevErrorMsg = ''
    setInterval(() => {
      const currentErrors = useTaskErrorStore.getState().errorLog
      const lastMsg = currentErrors.length > 0 ? currentErrors[currentErrors.length - 1].id : ''
      if (currentErrors.length !== prevErrorLen || lastMsg !== prevErrorMsg) {
        prevErrorLen = currentErrors.length
        prevErrorMsg = lastMsg
        set({ errors: [...currentErrors] })
      }
    }, 2000)

    // 初始加载已有日志
    if (window.__LOG_ENTRIES__) {
      set({ logs: [...window.__LOG_ENTRIES__] })
    }
  },
}))
