import { app, BrowserWindow, shell, dialog, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { initDatabase, seedEnzymes, seedUniversalPrimers, seedVectorComponents, ensureFixedUserDataDir, migrateFromOldAppNames, getDataDir, runTagsAutoAnnotation } from './database'
import { registerIpcHandlers } from './ipc'
import { IPC_CHANNELS } from '../shared/types'
import { initLanguage } from '../shared/i18n'
import { buildMenu } from './menu'
import { registerExportHandlers } from './export'
import { initLogger, createLogger } from './logger'
import { syncDevPluginConfigs } from './services/species-plugin-service'
import { regenerateGenesIndex } from './services/gene-file-service'

let mainWindow: BrowserWindow | null = null
const editorWindows = new Map<number, BrowserWindow>()
const editorDirtyState = new Map<number, boolean>()
const geneEditorWindows = new Map<number, BrowserWindow>()
const geneEditorDirtyState = new Map<number, boolean>()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    title: 'HelixCraft',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  console.log('[Window] Main window created')
  mainWindow.on('ready-to-show', () => {
    console.log('[Window] Main window ready-to-show')
    mainWindow?.show()
    // 确保菜单栏可见
    if (mainWindow) {
      const menu = Menu.getApplicationMenu()
      if (menu) mainWindow.setMenu(menu)
      mainWindow.setMenuBarVisibility(true)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 主窗口关闭时销毁所有子编辑器窗口，确保进程完全退出
  mainWindow.on('close', () => {
    for (const [, win] of editorWindows) {
      if (!win.isDestroyed()) win.destroy()
    }
    editorWindows.clear()
    editorDirtyState.clear()
    for (const [, win] of geneEditorWindows) {
      if (!win.isDestroyed()) win.destroy()
    }
    geneEditorWindows.clear()
    geneEditorDirtyState.clear()
  })

  // 转发主窗口渲染进程 console 到终端（调试用）
  mainWindow.webContents.on('console-message', (event, level, message) => {
    const prefix = level === 2 ? '[MAIN-ERR]' : '[MAIN]'
    console.log(`${prefix} ${message}`)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function createEditorWindow(vectorId: number): void {
  const existing = editorWindows.get(vectorId)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'HelixCraft - 载体图谱编辑器',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  editorWindows.set(vectorId, win)
  editorDirtyState.set(vectorId, false)
  console.log(`[Window] Editor window created for vectorId=${vectorId}`)

  // 监听渲染进程发来的脏状态变化
  const dirtyHandler = (_event: any, dirty: boolean): void => {
    // 只处理来自此窗口的消息
    if (_event.sender === win.webContents) {
      editorDirtyState.set(vectorId, dirty)
      win.setDocumentEdited(dirty)
    }
  }
  ipcMain.on(IPC_CHANNELS.EDITOR_SET_DIRTY, dirtyHandler)

  // 拦截关闭事件
  win.on('close', (e) => {
    const dirty = editorDirtyState.get(vectorId)
    if (!dirty) return

    e.preventDefault()
    const result = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['保存并关闭', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      title: '未保存的更改',
      message: '序列已被修改但尚未保存。是否保存更改？'
    })

    if (result === 0) {
      // 保存并关闭：通知渲染进程保存，保存完成后关闭
      win.webContents.send('editor:save-and-close')
      // 延迟关闭，让渲染进程完成保存
      setTimeout(() => {
        editorDirtyState.set(vectorId, false)
        if (!win.isDestroyed()) win.close()
      }, 1000)
    } else if (result === 1) {
      // 不保存
      editorDirtyState.set(vectorId, false)
      if (!win.isDestroyed()) win.close()
    }
    // result === 2: 取消关闭
  })

  win.on('closed', () => {
    console.log(`[Window] Editor window closed for vectorId=${vectorId}`)
    editorWindows.delete(vectorId)
    editorDirtyState.delete(vectorId)
    ipcMain.removeListener(IPC_CHANNELS.EDITOR_SET_DIRTY, dirtyHandler)
  })

  // 捕获渲染进程控制台输出到主进程终端
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const prefix = level === 2 ? '[EDITOR-ERR]' : '[EDITOR]'
    console.log(`${prefix} ${message}`)
  })

  win.on('ready-to-show', () => {
    win.show()
    // 确保编辑器窗口菜单栏可见
    const menu = Menu.getApplicationMenu()
    if (menu) win.setMenu(menu)
    win.setMenuBarVisibility(true)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?vectorId=${vectorId}&mode=editor`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { vectorId: String(vectorId), mode: 'editor' }
    })
  }
}

export function createGeneEditorWindow(geneId: number, transcriptId?: number, seqType?: 'mrna' | 'protein'): void {
  // 使用复合键区分不同序列类型的窗口
  const windowKey = transcriptId ? `${geneId}-${transcriptId}-${seqType}` : geneId
  const existing = geneEditorWindows.get(windowKey)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: seqType === 'protein' ? 'HelixCraft - 蛋白质序列查看器' : 'HelixCraft - 基因序列编辑器',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  geneEditorWindows.set(windowKey, win)
  geneEditorDirtyState.set(windowKey, false)
  console.log(`[Window] Gene editor window created for geneId=${geneId}, transcriptId=${transcriptId}, seqType=${seqType}`)

  win.on('close', (e) => {
    const dirty = geneEditorDirtyState.get(windowKey)
    if (!dirty) return
    e.preventDefault()
    const result = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['保存并关闭', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      title: '未保存的更改',
      message: '序列已被修改但尚未保存。是否保存更改？'
    })
    if (result === 0) {
      win.webContents.send('editor:save-and-close')
      setTimeout(() => {
        geneEditorDirtyState.set(windowKey, false)
        if (!win.isDestroyed()) win.close()
      }, 1000)
    } else if (result === 1) {
      geneEditorDirtyState.set(windowKey, false)
      if (!win.isDestroyed()) win.close()
    }
  })

  win.on('closed', () => {
    console.log(`[Window] Gene editor window closed for geneId=${geneId}, transcriptId=${transcriptId}`)
    geneEditorWindows.delete(windowKey)
    geneEditorDirtyState.delete(windowKey)
  })

  win.webContents.on('console-message', (event, level, message) => {
    const prefix = level === 2 ? '[GENE-EDITOR-ERR]' : '[GENE-EDITOR]'
    console.log(`${prefix} ${message}`)
  })

  win.on('ready-to-show', () => {
    win.show()
    const menu = Menu.getApplicationMenu()
    if (menu) win.setMenu(menu)
    win.setMenuBarVisibility(true)
  })

  // 构建查询参数
  const queryParams: Record<string, string> = { geneId: String(geneId), mode: 'gene-editor' }
  if (transcriptId) queryParams.transcriptId = String(transcriptId)
  if (seqType) queryParams.seqType = seqType

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const qs = new URLSearchParams(queryParams).toString()
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${qs}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: queryParams })
  }
}

/** 创建相关序列编辑器窗口（独立于转录本编辑器） */

// 蛋白质独立编辑器临时存储
const proteinStore = new Map<string, { name: string; sequence: string }>()

export function createProteinEditorWindow(name: string, sequence: string): void {
  const key = `protein-${Date.now()}`
  proteinStore.set(key, { name, sequence })

  const win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 1100, minHeight: 700, show: false,
    title: 'HelixCraft - 蛋白质序列编辑器',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, nodeIntegration: false }
  })

  win.on('closed', () => { proteinStore.delete(key) })
  win.on('ready-to-show', () => { win.show(); const menu = Menu.getApplicationMenu(); if (menu) win.setMenu(menu); win.setMenuBarVisibility(true) })

  const queryParams: Record<string, string> = { mode: 'protein-editor', proteinKey: key }
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${new URLSearchParams(queryParams).toString()}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: queryParams })
  }
}

export function getProteinStoreData(key: string): { name: string; sequence: string } | null {
  return proteinStore.get(key) || null
}
export function createRelatedSeqEditorWindow(geneId: number, relatedSeqId: number, seqType: string): void {
  // 使用 rs- 前缀区分窗口 key，避免与转录本冲突
  const windowKey = `rs-${geneId}-${relatedSeqId}`
  const existing = geneEditorWindows.get(windowKey as any)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'HelixCraft - 相关序列查看器',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  geneEditorWindows.set(windowKey as any, win)
  geneEditorDirtyState.set(windowKey as any, false)
  console.log(`[Window] Related seq editor window created: geneId=${geneId}, relatedSeqId=${relatedSeqId}, seqType=${seqType}`)

  win.on('close', (e) => {
    const dirty = geneEditorDirtyState.get(windowKey as any)
    if (!dirty) return
    e.preventDefault()
    const result = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['关闭', '取消'],
      defaultId: 0,
      cancelId: 1,
      title: '查看器',
      message: '确定关闭序列查看器？'
    })
    if (result === 0) {
      geneEditorDirtyState.set(windowKey as any, false)
      if (!win.isDestroyed()) win.close()
    }
  })

  win.on('closed', () => {
    console.log(`[Window] Related seq editor window closed: geneId=${geneId}, relatedSeqId=${relatedSeqId}`)
    geneEditorWindows.delete(windowKey as any)
    geneEditorDirtyState.delete(windowKey as any)
  })

  win.webContents.on('console-message', (event, level, message) => {
    const prefix = level === 2 ? '[RELATED-SEQ-ERR]' : '[RELATED-SEQ]'
    console.log(`${prefix} ${message}`)
  })

  win.on('ready-to-show', () => {
    win.show()
    const menu = Menu.getApplicationMenu()
    if (menu) win.setMenu(menu)
    win.setMenuBarVisibility(true)
  })

  // 构建查询参数：使用 relatedSeqId 而非 transcriptId
  const queryParams: Record<string, string> = {
    geneId: String(geneId),
    mode: 'gene-editor',
    relatedSeqId: String(relatedSeqId),
    seqType: seqType
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const qs = new URLSearchParams(queryParams).toString()
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${qs}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: queryParams })
  }
}

// ══════ 单实例锁：防止多实例争抢 SQLite 数据库文件锁 ══════
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  // 已有实例在运行，直接退出
  app.quit()
} else {
  // 第二实例启动时，聚焦已有窗口
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(async () => {
  // ══════ 第一步：固定数据目录（必须在所有 app.getPath('userData') 调用之前执行） ══════
  ensureFixedUserDataDir()

  // 初始化日志系统
  initLogger()
  const log = createLogger('App')
  log.info(`Application starting... (dataDir: ${getDataDir()})`)

  // 全局未捕获异常监听
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', err)
  })
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)))
  })

  // ══════ 第二步：旧版数据迁移（必须在 initDatabase 之前执行） ══════
  const migration = migrateFromOldAppNames()
  if (migration.migrated) {
    log.info(`[Migrate] Data migrated from ${migration.from} (${migration.files} files)`)
  }

  // 初始化语言
  initLanguage('zh')
  log.info('Language initialized: zh')
  await initDatabase()
  log.info('Database initialized')
  seedEnzymes()
  log.info('Enzyme seeds loaded')
  seedUniversalPrimers()
  log.info('Universal primer seeds loaded')
  seedVectorComponents()
  log.info('Component seeds loaded')
  runTagsAutoAnnotation()
  log.info('Tags auto-annotation done')
  // 同步开发目录 plugin.json（仅开发模式有效）
  try { syncDevPluginConfigs() } catch (e) { log.warn('Plugin sync skipped', e) }
  registerIpcHandlers()
  log.info('IPC handlers registered')
  registerExportHandlers()
  log.info('Export handlers registered')

  // 启动时自动生成/更新基因详情页 HTML（异步，不阻塞启动）
  setTimeout(() => {
    try { regenerateGenesIndex() } catch (e: any) { log.warn('Gene HTML generation skipped:', e.message) }
  }, 2000)

  createWindow()

  // 创建窗口后设置菜单
  try {
    buildMenu()
    log.info('Menu built successfully')
  } catch (err: any) {
    log.error('Failed to build menu', err)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  console.log('[App] All windows closed')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 安全网：确保退出前销毁所有残留窗口，避免进程残留
app.on('before-quit', () => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy()
  }
})
