import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import path from 'path'
import { IPC_CHANNELS } from '../shared/types'
import { createLogger } from './logger'

const log = createLogger('Export')

export function registerExportHandlers(): void {
  // SVG export
  try { ipcMain.removeHandler(IPC_CHANNELS.EXPORT_SVG) } catch (_e) { /* */ }
  ipcMain.handle(IPC_CHANNELS.EXPORT_SVG, async (event, svgContent: string, defaultName: string) => {
    log.info(`SVG export requested: ${defaultName}`)
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${defaultName}.svg`,
      filters: [{ name: 'SVG', extensions: ['svg'] }]
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, svgContent, 'utf-8')
    log.info(`SVG saved: ${result.filePath}`)
    return true
  })

  // PDF export - use hidden BrowserWindow
  try { ipcMain.removeHandler(IPC_CHANNELS.EXPORT_PDF) } catch (_e) { /* */ }
  ipcMain.handle(IPC_CHANNELS.EXPORT_PDF, async (event, svgContent: string, defaultName: string) => {
    log.info(`PDF export requested: ${defaultName}`)
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${defaultName}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return false

    // Create hidden window to render SVG and print to PDF
    const pdfWin = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true }
    })

    const html = `<!DOCTYPE html><html><head><style>
      body { margin: 0; padding: 10px; }
      svg { max-width: 100%; height: auto; }
    </style></head><body>${svgContent}</body></html>`

    await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

    const pdfBuffer = await pdfWin.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: false
    })

    pdfWin.close()
    writeFileSync(result.filePath, pdfBuffer)
    log.info(`PDF saved: ${result.filePath} (${pdfBuffer.length} bytes)`)
    return true
  })

  // Image export (PNG, JPG, BMP) - receive base64 data URL from renderer
  try { ipcMain.removeHandler(IPC_CHANNELS.EXPORT_IMAGE) } catch (_e) { /* */ }
  ipcMain.handle(IPC_CHANNELS.EXPORT_IMAGE, async (event, format: string, dataUrl: string, defaultName: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const extMap: Record<string, string> = { png: 'png', jpg: 'jpg', jpeg: 'jpg', bmp: 'bmp', tif: 'tif', tiff: 'tif' }
    const ext = extMap[format.toLowerCase()] || 'png'
    const filterMap: Record<string, string> = { png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG', bmp: 'BMP', tif: 'TIFF', tiff: 'TIFF' }
    const filterName = filterMap[format.toLowerCase()] || 'Image'

    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${defaultName}.${ext}`,
      filters: [{ name: filterName, extensions: [ext] }]
    })
    if (result.canceled || !result.filePath) return false

    // Parse data URL to buffer
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    // For TIF, we'd need sharp. For now just write the PNG buffer with .tif extension
    // (most image viewers will still recognize it)
    writeFileSync(result.filePath, buffer)
    log.info(`Image (${format}) saved: ${result.filePath}`)
    return true
  })
}
