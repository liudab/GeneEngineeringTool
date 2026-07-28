import { useRef, useCallback, useEffect, useMemo } from 'react'
import { createLogger, type RendererLogger } from '../utils/logger'

/**
 * 模块日志 hook —— 在组件内创建带模块标签的日志器
 * @param module 模块名称，例如 'ChromatogramViewer'
 */
export function useModuleLogger(module: string): RendererLogger {
  return useMemo(() => createLogger(module), [module])
}

/**
 * 节流日志 hook —— 高频事件（如 mousemove、scroll）每秒最多输出 1 次
 * @param prefix 日志前缀，例如 'ChromatogramViewer'
 */
export function useThrottledLog(prefix: string) {
  const log = useModuleLogger(prefix)
  const lastLogRef = useRef(0)
  return useCallback(
    (...args: any[]) => {
      const now = Date.now()
      if (now - lastLogRef.current >= 1000) {
        lastLogRef.current = now
        log.debug(args.map(String).join(' '))
      }
    },
    [log]
  )
}

/**
 * 组件生命周期日志 hook —— mount / unmount / props 变化
 * @param prefix 日志前缀
 * @param props  需要监控的 props 对象（可选）
 */
export function useLifecycleLog(prefix: string, props?: Record<string, any>) {
  const log = useModuleLogger(prefix)

  useEffect(() => {
    log.info('mounted')
    return () => { log.info('unmounted') }
  }, [])

  const prevPropsRef = useRef<Record<string, any> | undefined>(undefined)
  useEffect(() => {
    if (props && prevPropsRef.current) {
      const changed = Object.keys(props).filter(
        (k) => props[k] !== prevPropsRef.current?.[k]
      )
      if (changed.length > 0) {
        log.debug(`props changed: ${changed.join(', ')}`)
      }
    }
    prevPropsRef.current = props
  }, [props])
}
