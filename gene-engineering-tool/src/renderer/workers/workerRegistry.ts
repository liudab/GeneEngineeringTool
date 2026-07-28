/**
 * Worker 统一注册表
 * - Worker 池：同名 Worker 复用，不同名独立
 * - 任务队列：支持优先级排序（high > normal > low）
 * - 超时取消：超时自动 reject 并 terminate Worker
 * - 进度回调：通过 id 匹配 progress 消息到对应 Promise
 * - 错误重试：可配置重试次数（默认 0 不重试）
 */

// ─── 协议类型 ───────────────────────────────────────────────

/** 发送给 Worker 的任务请求 */
export interface WorkerTask<TInput = unknown> {
  id: string
  type: string
  input: TInput
}

/** Worker 返回的结果 */
export interface WorkerResult<TOutput = unknown> {
  id: string
  output?: TOutput
  error?: string
  /** 进度上报（中间消息） */
  progress?: { percent: number; message: string }
}

/** execute 的可选项 */
export interface ExecuteOptions {
  priority?: 'low' | 'normal' | 'high'
  /** 超时毫秒数，0 = 不限（默认 0） */
  timeout?: number
  /** 进度回调 */
  onProgress?: (percent: number, message: string) => void
  /** 失败后重试次数（默认 0） */
  retries?: number
}

// ─── 内部类型 ───────────────────────────────────────────────

interface PendingTask {
  id: string
  resolve: (value: any) => void
  reject: (reason: any) => void
  workerName: string
  taskType: string
  input: any
  options: Required<ExecuteOptions>
  retriesLeft: number
  timeoutId?: ReturnType<typeof setTimeout>
}

interface QueueEntry {
  task: PendingTask
  priority: number // 0=high, 1=normal, 2=low
  seq: number // 同优先级内 FIFO
}

interface WorkerEntry {
  worker: Worker
  /** 当前正在执行的任务 id */
  activeTaskId: string | null
}

// ─── 常量 ───────────────────────────────────────────────────

const PRIORITY_MAP: Record<string, number> = { high: 0, normal: 1, low: 2 }

// ─── 全局自增 id ────────────────────────────────────────────

let _taskSeq = 0
let _queueSeq = 0

function nextTaskId(): string {
  return `wt_${++_taskSeq}_${Date.now().toString(36)}`
}

// ─── WorkerRegistry ─────────────────────────────────────────

export class WorkerRegistry {
  /** Worker 池：name → WorkerEntry */
  private pool = new Map<string, WorkerEntry>()

  /** 等待队列（按优先级排序） */
  private queue: QueueEntry[] = []

  /** 所有 pending / running 任务：taskId → PendingTask */
  private pending = new Map<string, PendingTask>()

  /** Worker 工厂缓存：name → factory */
  private factories = new Map<string, () => Worker>()

  // ── Worker 生命周期 ─────────────────────────────────────

  /**
   * 注册 Worker 工厂并返回可复用的 Worker 实例。
   * 同名 Worker 只创建一次，后续调用直接返回已有实例。
   */
  getWorker(name: string, workerFactory: () => Worker): Worker {
    if (!this.factories.has(name)) {
      this.factories.set(name, workerFactory)
    }
    let entry = this.pool.get(name)
    if (!entry) {
      const worker = workerFactory()
      entry = { worker, activeTaskId: null }
      this.pool.set(name, entry)
      this.attachListener(name, entry)
    }
    return entry.worker
  }

  /** 终止并移除指定 Worker（其排队任务会被 reject） */
  terminate(name: string): void {
    const entry = this.pool.get(name)
    if (!entry) return

    // reject 所有该 Worker 上的 pending 任务
    for (const [, task] of this.pending) {
      if (task.workerName === name) {
        this.clearTask(task)
        task.reject(new Error(`Worker "${name}" terminated`))
      }
    }

    entry.worker.terminate()
    this.pool.delete(name)
    this.factories.delete(name)

    // 尝试从队列中调度其他任务
    this.drain()
  }

  /** 终止所有 Worker */
  terminateAll(): void {
    const names = [...this.pool.keys()]
    for (const name of names) {
      this.terminate(name)
    }
  }

  // ── 任务执行 ────────────────────────────────────────────

  /**
   * 向指定 Worker 提交任务，返回 Promise。
   * 如果 Worker 正忙，任务进入优先级队列等待。
   */
  execute<TInput, TOutput>(
    workerName: string,
    taskType: string,
    input: TInput,
    options?: ExecuteOptions
  ): Promise<TOutput> {
    // 确保 Worker 存在（惰性创建）
    const factory = this.factories.get(workerName)
    if (!factory) {
      return Promise.reject(
        new Error(`Worker "${workerName}" not registered. Call getWorker() first.`)
      )
    }

    const opts: Required<ExecuteOptions> = {
      priority: options?.priority ?? 'normal',
      timeout: options?.timeout ?? 0,
      onProgress: options?.onProgress ?? (() => {}),
      retries: options?.retries ?? 0
    }

    const id = nextTaskId()

    return new Promise<TOutput>((resolve, reject) => {
      const task: PendingTask = {
        id,
        resolve,
        reject,
        workerName,
        taskType,
        input,
        options: opts,
        retriesLeft: opts.retries
      }
      this.pending.set(id, task)

      const entry = this.pool.get(workerName)
      if (entry && entry.activeTaskId === null) {
        // Worker 空闲 → 立即派发
        this.dispatch(task, entry)
      } else {
        // Worker 忙 → 入队
        const queueEntry: QueueEntry = {
          task,
          priority: PRIORITY_MAP[opts.priority] ?? 1,
          seq: ++_queueSeq
        }
        this.insertQueue(queueEntry)
      }
    })
  }

  /** 取消指定任务（若还在队列中则移除；若正在执行则 terminate Worker） */
  cancel(taskId: string): void {
    const task = this.pending.get(taskId)
    if (!task) return

    // 从队列中移除
    const qIdx = this.queue.findIndex((e) => e.task.id === taskId)
    if (qIdx !== -1) {
      this.queue.splice(qIdx, 1)
      this.clearTask(task)
      task.reject(new Error('Task cancelled'))
      return
    }

    // 正在执行 → terminate Worker
    const entry = this.pool.get(task.workerName)
    if (entry && entry.activeTaskId === taskId) {
      this.clearTask(task)
      task.reject(new Error('Task cancelled'))
      this.terminate(task.workerName)
    }
  }

  // ── 状态查询 ────────────────────────────────────────────

  /** 指定 Worker 是否正在执行任务 */
  isRunning(workerName: string): boolean {
    const entry = this.pool.get(workerName)
    return !!entry && entry.activeTaskId !== null
  }

  /** 获取指定 Worker 正在执行的任务 id（无则返回 null） */
  getRunningTask(workerName: string): string | null {
    const entry = this.pool.get(workerName)
    return entry?.activeTaskId ?? null
  }

  /** 获取等待队列中的任务数量 */
  get queuedCount(): number {
    return this.queue.length
  }

  /** 获取正在执行的任务总数 */
  get runningCount(): number {
    let count = 0
    for (const entry of this.pool.values()) {
      if (entry.activeTaskId !== null) count++
    }
    return count
  }

  // ── 内部方法 ────────────────────────────────────────────

  /** 将任务派发给 Worker */
  private dispatch(task: PendingTask, entry: WorkerEntry): void {
    entry.activeTaskId = task.id

    // 设置超时
    if (task.options.timeout > 0) {
      task.timeoutId = setTimeout(() => {
        // 超时：terminate Worker 并 reject
        const currentEntry = this.pool.get(task.workerName)
        if (currentEntry && currentEntry.activeTaskId === task.id) {
          currentEntry.worker.terminate()
          currentEntry.activeTaskId = null

          // 重建 Worker（如果工厂还在）
          const factory = this.factories.get(task.workerName)
          if (factory) {
            const newWorker = factory()
            const newEntry: WorkerEntry = { worker: newWorker, activeTaskId: null }
            this.pool.set(task.workerName, newEntry)
            this.attachListener(task.workerName, newEntry)
          } else {
            this.pool.delete(task.workerName)
          }
        }

        this.clearTask(task)
        task.reject(new Error(`Task "${task.id}" timed out after ${task.options.timeout}ms`))
        this.drain()
      }, task.options.timeout)
    }

    // 发送消息给 Worker
    entry.worker.postMessage({
      id: task.id,
      type: task.taskType,
      input: task.input
    } satisfies WorkerTask)
  }

  /** 为 Worker 绑定 message / error 监听 */
  private attachListener(workerName: string, entry: WorkerEntry): void {
    entry.worker.addEventListener('message', (e: MessageEvent<WorkerResult>) => {
      const data = e.data
      const task = this.pending.get(data.id)
      if (!task) return

      // 进度消息 → 回调
      if (data.progress) {
        task.options.onProgress(data.progress.percent, data.progress.message)
        return
      }

      // 完成或错误
      this.clearTask(task)
      entry.activeTaskId = null

      if (data.error) {
        // 检查是否需要重试
        if (task.retriesLeft > 0) {
          task.retriesLeft--
          // 重新入队（优先级保持）
          const queueEntry: QueueEntry = {
            task,
            priority: PRIORITY_MAP[task.options.priority] ?? 1,
            seq: ++_queueSeq
          }
          this.insertQueue(queueEntry)
          this.drain()
        } else {
          task.reject(new Error(data.error))
        }
      } else {
        task.resolve(data.output)
      }

      // 尝试调度队列中的下一个任务
      this.drain()
    })

    entry.worker.addEventListener('error', (e: ErrorEvent) => {
      // Worker 运行时错误
      const activeId = entry.activeTaskId
      if (!activeId) return

      const task = this.pending.get(activeId)
      if (!task) return

      this.clearTask(task)
      entry.activeTaskId = null

      if (task.retriesLeft > 0) {
        task.retriesLeft--
        const queueEntry: QueueEntry = {
          task,
          priority: PRIORITY_MAP[task.options.priority] ?? 1,
          seq: ++_queueSeq
        }
        this.insertQueue(queueEntry)
        this.drain()
      } else {
        task.reject(new Error(e.message || 'Worker error'))
        this.drain()
      }
    })
  }

  /** 清理任务的定时器并从 pending 中移除 */
  private clearTask(task: PendingTask): void {
    if (task.timeoutId) {
      clearTimeout(task.timeoutId)
      task.timeoutId = undefined
    }
    this.pending.delete(task.id)
  }

  /** 按优先级插入队列（保持有序） */
  private insertQueue(entry: QueueEntry): void {
    let idx = this.queue.length
    for (let i = 0; i < this.queue.length; i++) {
      const existing = this.queue[i]
      if (entry.priority < existing.priority) {
        idx = i
        break
      }
      if (entry.priority === existing.priority && entry.seq < existing.seq) {
        idx = i
        break
      }
    }
    this.queue.splice(idx, 0, entry)
  }

  /** 尝试将队列中的任务派发给空闲的 Worker */
  private drain(): void {
    while (this.queue.length > 0) {
      const entry = this.queue[0]
      const workerEntry = this.pool.get(entry.task.workerName)

      // Worker 不存在或正忙 → 跳过（理论上不会发生，因为同名 Worker 共享）
      if (!workerEntry || workerEntry.activeTaskId !== null) {
        // 如果 Worker 不存在但工厂还在，重建
        if (!workerEntry) {
          const factory = this.factories.get(entry.task.workerName)
          if (factory) {
            const worker = factory()
            const newEntry: WorkerEntry = { worker, activeTaskId: null }
            this.pool.set(entry.task.workerName, newEntry)
            this.attachListener(entry.task.workerName, newEntry)
            this.dispatch(entry.task, newEntry)
            this.queue.shift()
            continue
          }
        }
        break
      }

      this.queue.shift()
      this.dispatch(entry.task, workerEntry)
    }
  }
}

// ─── 导出全局单例 ───────────────────────────────────────────

export const workerRegistry = new WorkerRegistry()
