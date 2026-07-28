/**
 * 渲染进程统一日志器
 * - 分级日志：DEBUG / INFO / WARN / ERROR
 * - 输出到 DevTools Console + 通过 IPC 转发到主进程写入文件
 * - createLogger(module) 工厂函数
 * - 支持 window.__DEBUG_LEVEL__ 动态控制
 */
import { LogLevel, LOG_LEVEL_NAMES, type LogEntry } from '../../shared/logger-types'

declare global {
  interface Window {
    __DEBUG_LEVEL__?: LogLevel
    __LOG_ENTRIES__?: LogEntry[]
    __LOG_LISTENERS__?: Array<(entry: LogEntry) => void>
  }
}

let entryCounter = 0

// 初始化全局存储
if (typeof window !== 'undefined') {
  if (!window.__LOG_ENTRIES__) window.__LOG_ENTRIES__ = []
  if (!window.__LOG_LISTENERS__) window.__LOG_LISTENERS__ = []
}

function getCurrentLevel(): LogLevel {
  if (typeof window !== 'undefined' && window.__DEBUG_LEVEL__ !== undefined) {
    return window.__DEBUG_LEVEL__
  }
  return LogLevel.DEBUG
}

function formatTimestamp(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function log(level: LogLevel, module: string, message: string, detail?: string): void {
  if (level < getCurrentLevel()) return

  const prefix = `[${formatTimestamp()}] [${module}] [${LOG_LEVEL_NAMES[level]}]`
  const entry: LogEntry = {
    id: `r-log-${++entryCounter}-${Date.now()}`,
    timestamp: Date.now(),
    level,
    module,
    message,
    detail,
  }

  // 输出到 DevTools Console
  switch (level) {
    case LogLevel.DEBUG:
      console.log(`%c${prefix}%c ${message}`, 'color: #888', 'color: inherit')
      break
    case LogLevel.INFO:
      console.log(`%c${prefix}%c ${message}`, 'color: #2196F3; font-weight: bold', 'color: inherit')
      break
    case LogLevel.WARN:
      console.warn(`${prefix} ${message}`, detail || '')
      break
    case LogLevel.ERROR:
      console.error(`${prefix} ${message}`, detail || '')
      break
  }

  // 存入全局日志（供诊断面板）— Worker 环境无 window，需保护
  if (typeof window !== 'undefined' && window.__LOG_ENTRIES__) {
    window.__LOG_ENTRIES__.push(entry)
    if (window.__LOG_ENTRIES__.length > 500) window.__LOG_ENTRIES__.shift()
  }

  // 通知监听器（debugStore）
  if (typeof window !== 'undefined' && window.__LOG_LISTENERS__) {
    for (const listener of window.__LOG_LISTENERS__) {
      try { listener(entry) } catch { /* 静默 */ }
    }
  }

  // 通过 IPC 转发到主进程写入文件（静默失败，不阻塞 UI）
  try {
    if (typeof window !== 'undefined' && window.api && (window.api as any).__logToMain) {
      (window.api as any).__logToMain(level, module, message, detail)
    }
  } catch { /* IPC 转发失败不影响前端 */ }
}

// ============ 公共 API ============

export interface RendererLogger {
  debug(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, errorOrDetail?: any): void
}

export function createLogger(module: string): RendererLogger {
  return {
    debug(message: string, ...args: any[]) {
      const msg = args.length ? `${message} ${args.map(a => typeof a === 'object' ? JSON.stringify(a)?.slice(0, 200) : String(a)).join(' ')}` : message
      log(LogLevel.DEBUG, module, msg)
    },
    info(message: string, ...args: any[]) {
      const msg = args.length ? `${message} ${args.map(a => typeof a === 'object' ? JSON.stringify(a)?.slice(0, 200) : String(a)).join(' ')}` : message
      log(LogLevel.INFO, module, msg)
    },
    warn(message: string, ...args: any[]) {
      const msg = args.length ? `${message} ${args.map(a => typeof a === 'object' ? JSON.stringify(a)?.slice(0, 200) : String(a)).join(' ')}` : message
      log(LogLevel.WARN, module, msg)
    },
    error(message: string, errorOrDetail?: any) {
      const detail = errorOrDetail instanceof Error
        ? `${errorOrDetail.message}\n${errorOrDetail.stack}`
        : errorOrDetail ? String(errorOrDetail) : undefined
      log(LogLevel.ERROR, module, message, detail)
    },
  }
}

/** 设置渲染进程日志级别 */
export function setDebugLevel(level: LogLevel): void {
  if (typeof window !== 'undefined') {
    window.__DEBUG_LEVEL__ = level
  }
}

/** 获取所有渲染进程日志条目 */
export function getLogEntries(): LogEntry[] {
  return typeof window !== 'undefined' && window.__LOG_ENTRIES__ ? [...window.__LOG_ENTRIES__] : []
}

/** 注册日志监听器（debugStore 使用） */
export function addLogListener(fn: (entry: LogEntry) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  if (!window.__LOG_LISTENERS__) window.__LOG_LISTENERS__ = []
  window.__LOG_LISTENERS__.push(fn)
  return () => {
    if (window.__LOG_LISTENERS__) {
      window.__LOG_LISTENERS__ = window.__LOG_LISTENERS__.filter(l => l !== fn)
    }
  }
}
