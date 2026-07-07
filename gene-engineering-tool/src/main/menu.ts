import { Menu, BrowserWindow, app } from 'electron'
import { t, getLanguage } from '../shared/i18n'

export function buildMenu(): void {
  const lang = getLanguage()
  const isMac = process.platform === 'darwin'
  console.log(`[Menu] Building menu for lang=${lang}, platform=${process.platform}`)

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: t('menu.file'),
      submenu: [
        {
          label: t('menu.file.open'),
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToFocused('open-file')
        },
        { type: 'separator' },
        {
          label: t('menu.file.saveAs'),
          submenu: [
            {
              label: t('menu.file.saveAsGenBank'),
              click: () => sendToFocused('save-as-genbank')
            },
            {
              label: t('menu.file.saveAsFasta'),
              click: () => sendToFocused('save-as-fasta')
            }
          ]
        },
        {
          label: t('menu.file.exportMap'),
          submenu: [
            { label: t('menu.file.exportSvg'), click: () => sendToFocused('export-svg') },
            { label: t('menu.file.exportPdf'), click: () => sendToFocused('export-pdf') },
            { label: t('menu.file.exportPng'), click: () => sendToFocused('export-png') },
            { label: t('menu.file.exportJpg'), click: () => sendToFocused('export-jpg') },
            { label: t('menu.file.exportBmp'), click: () => sendToFocused('export-bmp') },
            { label: t('menu.file.exportTif'), click: () => sendToFocused('export-tif') }
          ]
        },
        { type: 'separator' },
        isMac
          ? { label: t('menu.file.quit'), role: 'close' as const }
          : { label: t('menu.file.quit'), accelerator: 'CmdOrCtrl+Q', role: 'quit' as const }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { label: t('menu.edit.undo'), role: 'undo' },
        { label: t('menu.edit.redo'), role: 'redo' },
        { type: 'separator' },
        { label: t('menu.edit.cut'), role: 'cut' },
        { label: t('menu.edit.copy'), role: 'copy' },
        { label: t('menu.edit.paste'), role: 'paste' },
        { type: 'separator' },
        { label: t('menu.edit.selectAll'), role: 'selectAll' }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        { label: t('menu.view.circular'), click: () => sendToFocused('view-circular') },
        { label: t('menu.view.linear'), click: () => sendToFocused('view-linear') },
        { type: 'separator' },
        { label: t('menu.view.zoomIn'), accelerator: 'CmdOrCtrl+=', click: () => sendToFocused('zoom-in') },
        { label: t('menu.view.zoomOut'), accelerator: 'CmdOrCtrl+-', click: () => sendToFocused('zoom-out') },
        { label: t('menu.view.zoomReset'), accelerator: 'CmdOrCtrl+0', click: () => sendToFocused('zoom-reset') }
      ]
    },
    {
      label: t('menu.settings'),
      submenu: [
        { label: t('menu.settings.style'), click: () => sendToFocused('show-style-dialog') },
        { label: t('menu.settings.enzyme'), click: () => sendToFocused('show-enzyme-settings') },
        { type: 'separator' },
        {
          label: t('menu.settings.language'),
          submenu: [
            {
              label: t('menu.settings.language.zh'),
              type: 'radio',
              checked: lang === 'zh',
              click: () => sendToFocused('set-language-zh')
            },
            {
              label: t('menu.settings.language.en'),
              type: 'radio',
              checked: lang === 'en',
              click: () => sendToFocused('set-language-en')
            }
          ]
        }
      ]
    },
    {
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.help.about'),
          click: () => {
            const win = BrowserWindow.getFocusedWindow()
            if (win) {
              const { dialog } = require('electron')
              dialog.showMessageBox(win, {
                type: 'info',
                title: t('about.title'),
                message: t('about.description')
              })
            }
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function sendToFocused(action: string): void {
  const win = BrowserWindow.getFocusedWindow()
  if (win) {
    win.webContents.send('menu:action', action)
  }
}
