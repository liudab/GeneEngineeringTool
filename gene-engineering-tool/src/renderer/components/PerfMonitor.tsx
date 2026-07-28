import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { Activity, X, Clock, Zap, Cpu, BarChart3 } from 'lucide-react'

// ============ 全局性能标记 API ============
export interface PerfMark {
  name: string
  startTime: number
  duration?: number
}

export interface PerfStats {
  fps: number
  avgFps: number
  minFps: number
  frameTime: number
  memoryMB: number | null
  interactionLatency: number | null
  marks: PerfMark[]
  renderCount: number
  uptime: number
}

/** 全局性能数据收集器（单例，不依赖 React） */
class PerfCollector {
  private frames: number[] = []
  private lastFrameTime = 0
  private rafId = 0
  private running = false
  private _marks: PerfMark[] = []
  private _interactionLatencies: number[] = []
  private _renderCount = 0
  private _startTime = Date.now()
  private _fpsHistory: number[] = []
  private _lastFpsCalc = 0
  private _frameCount = 0
  private _currentFps = 60
  private listeners: Set<(stats: PerfStats) => void> = new Set()

  start() {
    if (this.running) return
    this.running = true
    this._startTime = Date.now()
    this.lastFrameTime = performance.now()
    this._lastFpsCalc = performance.now()
    this.loop()
    this.setupInteractionTracking()
  }

  stop() {
    this.running = false
    if (this.rafId) cancelAnimationFrame(this.rafId)
  }

  private loop = () => {
    if (!this.running) return
    const now = performance.now()
    const delta = now - this.lastFrameTime
    this.lastFrameTime = now

    // 保存帧时间（最近 120 帧）
    this.frames.push(delta)
    if (this.frames.length > 120) this.frames.shift()

    // 每秒计算一次 FPS
    this._frameCount++
    if (now - this._lastFpsCalc >= 1000) {
      this._currentFps = Math.round(this._frameCount * 1000 / (now - this._lastFpsCalc))
      this._fpsHistory.push(this._currentFps)
      if (this._fpsHistory.length > 60) this._fpsHistory.shift()
      this._frameCount = 0
      this._lastFpsCalc = now
      this.notify()
    }

    this.rafId = requestAnimationFrame(this.loop)
  }

  private setupInteractionTracking() {
    // 追踪交互延迟：pointerdown → 下一帧渲染完成
    let pointerDownTime = 0
    document.addEventListener('pointerdown', () => {
      pointerDownTime = performance.now()
    }, { capture: true, passive: true })

    document.addEventListener('pointerup', () => {
      if (pointerDownTime > 0) {
        const latency = performance.now() - pointerDownTime
        this._interactionLatencies.push(latency)
        if (this._interactionLatencies.length > 50) this._interactionLatencies.shift()
        pointerDownTime = 0
      }
    }, { capture: true, passive: true })
  }

  /** 记录性能标记 */
  mark(name: string, startTime: number, duration?: number) {
    this._marks.push({ name, startTime, duration })
    if (this._marks.length > 100) this._marks.shift()
    this.notify()
  }

  /** 记录渲染次数 */
  recordRender() {
    this._renderCount++
  }

  subscribe(fn: (stats: PerfStats) => void) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private notify() {
    const stats = this.getStats()
    this.listeners.forEach(fn => fn(stats))
  }

  getStats(): PerfStats {
    const recentFrames = this.frames.slice(-60)
    const avgFrameTime = recentFrames.length > 0
      ? recentFrames.reduce((a, b) => a + b, 0) / recentFrames.length
      : 16.67
    const minFps = this._fpsHistory.length > 0 ? Math.min(...this._fpsHistory) : 60
    const avgFps = this._fpsHistory.length > 0
      ? Math.round(this._fpsHistory.reduce((a, b) => a + b, 0) / this._fpsHistory.length)
      : 60
    const lastLatency = this._interactionLatencies.length > 0
      ? this._interactionLatencies[this._interactionLatencies.length - 1]
      : null

    let memoryMB: number | null = null
    try {
      const mem = (performance as any).memory
      if (mem) memoryMB = Math.round(mem.usedJSHeapSize / 1024 / 1024)
    } catch {}

    return {
      fps: this._currentFps,
      avgFps,
      minFps,
      frameTime: Math.round(avgFrameTime * 10) / 10,
      memoryMB,
      interactionLatency: lastLatency !== null ? Math.round(lastLatency * 10) / 10 : null,
      marks: [...this._marks],
      renderCount: this._renderCount,
      uptime: Math.round((Date.now() - this._startTime) / 1000),
    }
  }

  getFpsHistory(): number[] {
    return [...this._fpsHistory]
  }
}

/** 全局单例 */
export const perfCollector = new PerfCollector()

// ============ 便捷埋点 API ============
/** 标记一个计时起点，返回结束函数 */
export function perfMeasure(name: string): () => void {
  const start = performance.now()
  return () => {
    perfCollector.mark(name, start, performance.now() - start)
  }
}

/** 直接记录一个已完成的耗时 */
export function perfMark(name: string, durationMs: number) {
  perfCollector.mark(name, performance.now() - durationMs, durationMs)
}

// ============ UI 组件 ============
const PerfMonitor = memo(function PerfMonitor({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [stats, setStats] = useState<PerfStats | null>(null)
  const [fpsHistory, setFpsHistory] = useState<number[]>([])
  const [expanded, setExpanded] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // 订阅性能数据
  useEffect(() => {
    if (!visible) return
    perfCollector.start()
    const unsub = perfCollector.subscribe((s) => {
      setStats(s)
      setFpsHistory(perfCollector.getFpsHistory())
    })
    // 立即获取一次
    setStats(perfCollector.getStats())
    setFpsHistory(perfCollector.getFpsHistory())
    return unsub
  }, [visible])

  // 绘制 FPS 历史图
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || fpsHistory.length < 2) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // 背景网格线 (60fps, 30fps)
    ctx.strokeStyle = 'rgba(148,163,184,0.2)'
    ctx.lineWidth = 0.5
    const y60 = H - (60 / 120) * H
    const y30 = H - (30 / 120) * H
    ctx.beginPath(); ctx.moveTo(0, y60); ctx.lineTo(W, y60); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, y30); ctx.lineTo(W, y30); ctx.stroke()

    // FPS 曲线
    const step = W / Math.max(fpsHistory.length - 1, 1)
    ctx.beginPath()
    ctx.strokeStyle = '#8b5cf6'
    ctx.lineWidth = 1.5
    fpsHistory.forEach((fps, i) => {
      const x = i * step
      const y = H - (Math.min(fps, 120) / 120) * H
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // 渐变填充
    const gradient = ctx.createLinearGradient(0, 0, 0, H)
    gradient.addColorStop(0, 'rgba(139,92,246,0.15)')
    gradient.addColorStop(1, 'rgba(139,92,246,0)')
    ctx.lineTo((fpsHistory.length - 1) * step, H)
    ctx.lineTo(0, H)
    ctx.closePath()
    ctx.fillStyle = gradient
    ctx.fill()
  }, [fpsHistory])

  if (!visible || !stats) return null

  const fpsColor = stats.fps >= 50 ? 'text-emerald-400' : stats.fps >= 30 ? 'text-amber-400' : 'text-red-400'
  const latencyColor = (stats.interactionLatency ?? 0) < 50 ? 'text-emerald-400' : (stats.interactionLatency ?? 0) < 150 ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="fixed bottom-3 left-3 z-[99999] select-none">
      <div className="bg-slate-900/95 backdrop-blur-sm text-slate-200 rounded-lg shadow-xl border border-slate-700/50 overflow-hidden"
        style={{ width: expanded ? 320 : 200 }}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/80 border-b border-slate-700/50">
          <div className="flex items-center gap-1.5">
            <Activity size={11} className="text-violet-400" />
            <span className="text-[10px] font-bold text-slate-300">性能监视器</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded(!expanded)}
              className="p-0.5 text-slate-400 hover:text-slate-200" title={expanded ? '收起' : '展开'}>
              <BarChart3 size={11} />
            </button>
            <button onClick={onClose} className="p-0.5 text-slate-400 hover:text-red-400">
              <X size={11} />
            </button>
          </div>
        </div>

        {/* 核心指标 */}
        <div className="px-3 py-2 grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className={`text-lg font-bold font-mono ${fpsColor}`}>{stats.fps}</div>
            <div className="text-[8px] text-slate-500 uppercase">FPS</div>
          </div>
          <div className="text-center">
            <div className={`text-lg font-bold font-mono ${latencyColor}`}>
              {stats.interactionLatency !== null ? `${Math.round(stats.interactionLatency)}` : '--'}
            </div>
            <div className="text-[8px] text-slate-500 uppercase">延迟 ms</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold font-mono text-sky-400">
              {stats.memoryMB !== null ? stats.memoryMB : '--'}
            </div>
            <div className="text-[8px] text-slate-500 uppercase">MB</div>
          </div>
        </div>

        {/* FPS 历史图 */}
        {expanded && (
          <div className="px-3 pb-2">
            <canvas ref={canvasRef} width={296} height={60}
              className="w-full h-[60px] rounded bg-slate-800/50 border border-slate-700/30" />
            <div className="flex justify-between text-[8px] text-slate-500 mt-0.5">
              <span>60s 前</span>
              <span>现在</span>
            </div>
          </div>
        )}

        {/* 详细指标 */}
        <div className="px-3 pb-2 space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500 flex items-center gap-1"><Zap size={9} /> 帧时间</span>
            <span className="font-mono text-slate-300">{stats.frameTime} ms</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500 flex items-center gap-1"><Clock size={9} /> 平均 FPS</span>
            <span className="font-mono text-slate-300">{stats.avgFps} (min {stats.minFps})</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500 flex items-center gap-1"><Cpu size={9} /> 运行时间</span>
            <span className="font-mono text-slate-300">{formatUptime(stats.uptime)}</span>
          </div>
        </div>

        {/* 性能标记列表 */}
        {expanded && stats.marks.length > 0 && (
          <div className="px-3 pb-2 border-t border-slate-700/50 pt-1.5">
            <div className="text-[9px] font-bold text-slate-400 mb-1">加载/操作计时</div>
            <div className="max-h-[120px] overflow-y-auto space-y-0.5">
              {stats.marks.slice(-15).reverse().map((m, i) => (
                <div key={i} className="flex items-center justify-between text-[9px]">
                  <span className="text-slate-400 truncate flex-1">{m.name}</span>
                  <span className={`font-mono ml-2 ${(m.duration ?? 0) > 500 ? 'text-red-400' : (m.duration ?? 0) > 100 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {m.duration !== undefined ? `${Math.round(m.duration)} ms` : '...'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default PerfMonitor
