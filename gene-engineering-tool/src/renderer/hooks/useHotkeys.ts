import { useEffect, useRef, useCallback } from 'react'

interface HotkeyDef {
  key: string          // e.g. 's', 'z', 'k', 'Escape'
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  label: string        // 显示名称
  action: () => void
  enabled?: boolean    // 默认 true
  global?: boolean     // 是否全局（不聚焦也能触发）
}

/**
 * 全局快捷键注册 hook
 * - 自动防止 input/textarea/select 内的快捷键冲突
 * - 支持 Ctrl/Shift/Alt 组合键
 * - 返回已注册的快捷键列表（供快捷键面板使用）
 */
export function useHotkeys(hotkeys: HotkeyDef[]) {
  const hotkeysRef = useRef(hotkeys)
  hotkeysRef.current = hotkeys

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 忽略输入框内的按键（除非是 global 快捷键）
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable

      for (const hk of hotkeysRef.current) {
        if (hk.enabled === false) continue
        if (!hk.global && isInput) continue

        const keyMatch = e.key.toLowerCase() === hk.key.toLowerCase()
        const ctrlMatch = !!hk.ctrl === (e.ctrlKey || e.metaKey)
        const shiftMatch = !!hk.shift === e.shiftKey
        const altMatch = !!hk.alt === e.altKey

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault()
          e.stopPropagation()
          hk.action()
          return
        }
      }
    }

    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [])

  const registeredKeys = hotkeys.filter(h => h.enabled !== false).map(h => ({
    key: h.key,
    ctrl: h.ctrl,
    shift: h.shift,
    alt: h.alt,
    label: h.label
  }))

  return { registeredKeys }
}

/**
 * 格式化快捷键为可读字符串
 */
export function formatHotkey(hk: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }): string {
  const parts: string[] = []
  if (hk.ctrl) parts.push('Ctrl')
  if (hk.shift) parts.push('Shift')
  if (hk.alt) parts.push('Alt')
  const keyMap: Record<string, string> = {
    escape: 'Esc', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
    enter: 'Enter', delete: 'Del', backspace: '⌫', tab: 'Tab', ' ': 'Space'
  }
  parts.push(keyMap[hk.key.toLowerCase()] || hk.key.toUpperCase())
  return parts.join('+')
}
