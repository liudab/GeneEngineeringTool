/**
 * 主进程统一日志器
 * - 分级日志：DEBUG / INFO / WARN / ERROR
 * - 带时间戳、模块标签
 * - 文件持久化 + 自动轮转（保留最近 5 个文件）
 * - createLogger(module) 工厂函数
 */
import { app } from 'electron'
import { appendFileSync, mkdirSync, existsSync, readdirSync, statSync, renameSync, unlinkSync } from 'fs'
import { join } from 'path'
import { LogLevel, LOG_LEVEL_NAMES, type LogEntry } from '../shared/logger-types'

// ============ 配置 ============
const MAX_LOG_FILES = 5
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
let currentLogLevel: LogLevel = LogLevel.DEBUG
let logDir = ''
let currentLogFile = ''
let entryCounter = 0

/** 内存中最近的日志（供诊断面板读取，上限 500 条） */
const recentLogs: LogEntry[] = []
const MAX_RECENT = 500

function ensureLogDir(): void {
  if (logDir) return
  try {
    logDir = join(app.getPath('userData'), 'logs')
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
    currentLogFile = join(logDir, `app-${formatDate()}.log`)
    rotateIfNeeded()
  } catch (e) {
    // 降级：写入临时目录
    logDir = join(app.getPath('temp'), 'gene-tool-logs')
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
    currentLogFile = join(logDir, `app-${formatDate()}.log`)
  }
}

function formatDate(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function formatTimestamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function rotateIfNeeded(): void {
  try {
    if (!existsSync(currentLogFile)) return
    const st = statSync(currentLogFile)
    if (st.size < MAX_FILE_SIZE) return
    // 当前文件已大，轮转
    const rotated = currentLogFile.replace('.log', `-${Date.now()}.log`)
    renameSync(currentLogFile, rotated)
    cleanupOldLogs()
  } catch { /* 静默 */ }
}

function cleanupOldLogs(): void {
  try {
    const files = readdirSync(logDir)
      .filter(f => f.startsWith('app-') && f.endsWith('.log'))
      .map(f => ({ name: f, path: join(logDir, f), mtime: statSync(join(logDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    if (files.length > MAX_LOG_FILES) {
      files.slice(MAX_LOG_FILES).forEach(f => {
        try { unlinkSync(f.path) } catch { /* 静默 */ }
      })
    }
  } catch { /* 静默 */ }
}

function writeToFile(line: string): void {
  try {
    ensureLogDir()
    appendFileSync(currentLogFile, line + '\n', 'utf-8')
  } catch { /* 文件写入失败不阻塞主流程 */ }
}

function formatLine(level: LogLevel, module: string, message: string): string {
  return `[${formatTimestamp()}] [${module}] [${LOG_LEVEL_NAMES[level]}] ${message}`
}

function log(level: LogLevel, module: string, message: string, detail?: string): void {
  if (level < currentLogLevel) return

  const line = formatLine(level, module, message)
  const entry: LogEntry = {
    id: `log-${++entryCounter}-${Date.now()}`,
    timestamp: Date.now(),
    level,
    module,
    message,
    detail,
  }

  // 输出到控制台
  switch (level) {
    case LogLevel.DEBUG: console.log(line); break
    case LogLevel.INFO: console.log(line); break
    case LogLevel.WARN: console.warn(line); break
    case LogLevel.ERROR: console.error(line, detail || ''); break
  }

  // 写入文件
  writeToFile(detail ? `${line}\n  ${detail}` : line)

  // 存入内存
  recentLogs.push(entry)
  if (recentLogs.length > MAX_RECENT) recentLogs.shift()
}

// ============ 公共 API ============

export interface Logger {
  debug(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, errorOrDetail?: any): void
}

export function createLogger(module: string): Logger {
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

/** 设置全局日志级别 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level
}

/** 获取最近的日志条目（供 IPC 调用） */
export function getRecentLogs(): LogEntry[] {
  return [...recentLogs]
}

/** 获取日志目录路径 */
export function getLogDir(): string {
  ensureLogDir()
  return logDir
}

/** 初始化日志系统（应用启动时调用） */
export function initLogger(): void {
  ensureLogDir()
  const log = createLogger('App')
  log.info(`Logger initialized, log dir: ${logDir}, level: ${LOG_LEVEL_NAMES[currentLogLevel]}`)
}

/** 从渲染进程接收日志并写入文件 */
export function logFromRenderer(level: LogLevel, module: string, message: string, detail?: string): void {
  log(level, `[R:${module}]`, message, detail)
}
