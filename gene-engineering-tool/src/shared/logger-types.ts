/**
 * 统一日志系统 — 共享类型定义
 * 主进程和渲染进程共用
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
}

export interface LogEntry {
  id: string
  timestamp: number
  level: LogLevel
  module: string
  message: string
  detail?: string  // 堆栈或额外上下文
}

/** 日志相关 IPC 通道 */
export const LOG_IPC_CHANNELS = {
  /** 渲染进程 -> 主进程：转发日志写入文件 */
  LOG_FROM_RENDERER: 'debug:log-from-renderer',
  /** 渲染进程 -> 主进程：获取持久化日志 */
  DEBUG_GET_LOGS: 'debug:get-logs',
  /** 渲染进程 -> 主进程：导出日志文件 */
  DEBUG_EXPORT_LOGS: 'debug:export-logs',
  /** 渲染进程 -> 主进程：打开日志目录 */
  DEBUG_OPEN_LOG_FOLDER: 'debug:open-log-folder',
  /** 渲染进程 -> 主进程：获取系统状态 */
  DEBUG_GET_SYSTEM_STATUS: 'debug:get-system-status',
} as const
