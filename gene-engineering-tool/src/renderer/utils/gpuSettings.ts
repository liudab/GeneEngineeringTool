/**
 * GPU 加速设置工具
 * - localStorage 持久化
 * - React hook 消费
 * - CSS 类名辅助
 */
import { useState, useCallback, useMemo } from 'react'

const STORAGE_KEY = 'gpuAccelerationEnabled'

/** 读取 GPU 加速开关（默认开启） */
export function getGpuAcceleration(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v !== 'false' // 默认 true
  } catch {
    return true
  }
}

/** 写入 GPU 加速开关 */
export function setGpuAcceleration(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled))
    // 通知所有监听者
    window.dispatchEvent(new CustomEvent('gpu-acceleration-change', { detail: enabled }))
  } catch {}
}

/** React hook：订阅 GPU 加速状态变化 */
export function useGpuAcceleration(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState(getGpuAcceleration)

  const toggle = useCallback((v: boolean) => {
    setGpuAcceleration(v)
    setEnabled(v)
  }, [])

  // 监听跨组件变化
  useState(() => {
    const handler = (e: Event) => setEnabled((e as CustomEvent).detail)
    window.addEventListener('gpu-acceleration-change', handler)
    return () => window.removeEventListener('gpu-acceleration-change', handler)
  })

  return [enabled, toggle]
}

/**
 * 获取 GPU 加速相关的 CSS 样式对象
 * 仅对频繁变换的元素启用，避免过度创建合成层
 */
export function gpuStyles(enabled: boolean, options?: { transform?: boolean; willChange?: boolean }): React.CSSProperties {
  if (!enabled) return {}
  const styles: React.CSSProperties = {}
  if (options?.willChange !== false) {
    styles.willChange = 'transform'
  }
  if (options?.transform !== false) {
    styles.transform = 'translateZ(0)'
  }
  return styles
}

/**
 * 获取 GPU 加速 CSS 类名（Tailwind 兼容）
 * 用于静态元素的 GPU 提升（不含 will-change，减少显存开销）
 */
export function gpuClass(enabled: boolean): string {
  return enabled ? 'transform-gpu' : ''
}
