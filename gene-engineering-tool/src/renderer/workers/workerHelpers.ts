/**
 * Worker 工具函数
 * - setupWorkerHandler: Worker 端统一消息分发（在 .worker.ts 文件内使用）
 * - createWorkerProxy: 主线程端 Promise 包装
 *
 * 注意：Worker 中不能访问 window，只能使用 self
 */

import type { WorkerTask, WorkerResult } from './workerRegistry'

// Web Worker 全局作用域类型（避免依赖 lib: webworker，防止与 DOM 冲突）
interface WorkerGlobalScope {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage(message: any): void
  addEventListener(type: string, listener: (e: any) => void): void
  removeEventListener(type: string, listener: (e: any) => void): void
}

// ─── Worker 端：消息处理 ────────────────────────────────────

/**
 * 在 Worker 文件中调用，统一处理来自主线程的消息。
 *
 * @example
 * ```ts
 * // primerWorker.ts
 * import { setupWorkerHandler } from '@/workers/workerHelpers'
 *
 * setupWorkerHandler({
 *   async design(input, reportProgress) {
 *     reportProgress(10, '开始设计...')
 *     const result = await designPrimers(input)
 *     reportProgress(100, '完成')
 *     return result
 *   },
 *   async validate(input) {
 *     return validatePrimers(input)
 *   }
 * })
 * ```
 *
 * @param handlers 任务类型 → 处理函数的映射
 *   - 处理函数接收 (input, reportProgress) 参数
 *   - reportProgress 用于向主线程上报进度
 *   - 返回值会通过 postMessage 发送回主线程
 *   - 抛出异常会自动转为 error 消息
 */
export function setupWorkerHandler(
  handlers: Record<
    string,
    (
      input: any,
      reportProgress: (percent: number, message: string) => void
    ) => any | Promise<any>
  >
): void {
  const ctx = self as unknown as WorkerGlobalScope

  ctx.onmessage = async (e: MessageEvent<WorkerTask>) => {
    const { id, type, input } = e.data

    /** 向主线程上报进度 */
    const reportProgress = (percent: number, message: string): void => {
      ctx.postMessage({ id, progress: { percent, message } } satisfies Partial<WorkerResult>)
    }

    try {
      const handler = handlers[type]
      if (!handler) {
        throw new Error(`Unknown task type: "${type}"`)
      }

      const output = await handler(input, reportProgress)

      ctx.postMessage({ id, output } satisfies WorkerResult)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      ctx.postMessage({ id, error: message } satisfies WorkerResult)
    }
  }
}

// ─── 主线程端：Promise 包装 ─────────────────────────────────

/**
 * 为主线程提供简洁的 Worker Promise 包装。
 * 适合不需要完整 Registry 功能的简单场景。
 *
 * @example
 * ```ts
 * const worker = new Worker(new URL('./my.worker.ts', import.meta.url), { type: 'module' })
 * const proxy = createWorkerProxy(worker)
 *
 * const result = await proxy.execute<MyOutput>('design', input)
 * proxy.terminate()
 * ```
 */
export function createWorkerProxy(worker: Worker): {
  execute: <T>(type: string, input: any) => Promise<T>
  terminate: () => void
} {
  let idSeq = 0

  return {
    execute<T>(type: string, input: any): Promise<T> {
      const id = `proxy_${++idSeq}_${Date.now().toString(36)}`

      return new Promise<T>((resolve, reject) => {
        const handler = (e: MessageEvent<WorkerResult<T>>) => {
          const data = e.data
          if (data.id !== id) return

          // 忽略进度消息
          if (data.progress) return

          worker.removeEventListener('message', handler)

          if (data.error) {
            reject(new Error(data.error))
          } else {
            resolve(data.output as T)
          }
        }

        worker.addEventListener('message', handler)

        const errorHandler = (e: ErrorEvent) => {
          worker.removeEventListener('message', handler)
          worker.removeEventListener('error', errorHandler)
          reject(new Error(e.message || 'Worker error'))
        }
        worker.addEventListener('error', errorHandler)

        worker.postMessage({ id, type, input } satisfies WorkerTask)
      })
    },

    terminate(): void {
      worker.terminate()
    }
  }
}
