import { app, BrowserWindow, shell, dialog, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { initDatabase, seedEnzymes, seedUniversalPrimers } from './database'
import { registerIpcHandlers } from './ipc'
import { IPC_CHANNELS } from '../shared/types'
import { initLanguage } from '../shared/i18n'
import { buildMenu } from './menu'
import { registerExportHandlers } from './export'

let mainWindow: BrowserWindow | null = null
const editorWindows = new Map<number, BrowserWindow>()
const editorDirtyState = new Map<number, boolean>()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    title: '基因工程辅助软件',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
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
    title: '载体图谱编辑器',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  editorWindows.set(vectorId, win)
  editorDirtyState.set(vectorId, false)

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

app.whenReady().then(async () => {
  // 初始化语言
  initLanguage('zh')
  await initDatabase()
  seedEnzymes()
  seedUniversalPrimers()
  registerIpcHandlers()
  registerExportHandlers()
  createWindow()

  // 创建窗口后设置菜单
  try {
    buildMenu()
    console.log('[Menu] Menu built successfully')
  } catch (err) {
    console.error('[Menu] Failed to build menu:', err)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
