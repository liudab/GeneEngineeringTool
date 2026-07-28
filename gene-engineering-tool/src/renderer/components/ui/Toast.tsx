import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import { X, CheckCircle2, AlertTriangle, AlertCircle, Info } from 'lucide-react'

// ============ Types ============
export type ToastType = 'success' | 'warning' | 'error' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
  description?: string
  action?: { label: string; onClick: () => void }
  duration?: number // ms, default 5000, 0 = persistent
}

interface ToastContextValue {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => string
  removeToast: (id: string) => void
  success: (message: string, description?: string) => string
  warning: (message: string, description?: string) => string
  error: (message: string, description?: string) => string
  info: (message: string, description?: string) => string
}

// ============ Context ============
const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// ============ Provider ============
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counterRef = useRef(0)

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${++counterRef.current}-${Date.now()}`
    const newToast: Toast = { ...toast, id }
    setToasts(prev => {
      const next = [...prev, newToast]
      // 同时最多显示3条
      return next.length > 3 ? next.slice(-3) : next
    })
    // 自动消失（duration=0 不自动消失）
    const duration = toast.duration ?? 5000
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration)
    }
    return id
  }, [removeToast])

  const success = useCallback((message: string, description?: string) =>
    addToast({ type: 'success', message, description }), [addToast])

  const warning = useCallback((message: string, description?: string) =>
    addToast({ type: 'warning', message, description, duration: 8000 }), [addToast])

  const error = useCallback((message: string, description?: string) =>
    addToast({ type: 'error', message, description, duration: 0 }), [addToast])

  const info = useCallback((message: string, description?: string) =>
    addToast({ type: 'info', message, description }), [addToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, warning, error, info }}>
      {children}
      <ToastStack toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

// ============ Toast UI ============
const ICONS: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info
}

const STYLES: Record<ToastType, { bg: string; border: string; icon: string; text: string }> = {
  success: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'text-emerald-500', text: 'text-emerald-800' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-500', text: 'text-amber-800' },
  error: { bg: 'bg-red-50', border: 'border-red-200', icon: 'text-red-500', text: 'text-red-800' },
  info: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-500', text: 'text-blue-800' }
}

function ToastStack({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[99999] flex flex-col-reverse gap-2 max-w-sm">
      {toasts.map(toast => {
        const Icon = ICONS[toast.type]
        const style = STYLES[toast.type]
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-2.5 p-3 rounded-lg border shadow-lg ${style.bg} ${style.border} animate-[toast-in_150ms_ease-out]`}
            style={{ minWidth: 280 }}
          >
            <Icon size={16} className={`${style.icon} flex-shrink-0 mt-0.5`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${style.text}`}>{toast.message}</p>
              {toast.description && (
                <p className="text-xs text-slate-500 mt-0.5 break-words">{toast.description}</p>
              )}
              {toast.action && (
                <button
                  onClick={() => { toast.action?.onClick(); onRemove(toast.id) }}
                  className={`text-xs font-medium mt-1 hover:underline ${style.text}`}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => onRemove(toast.id)}
              className="p-0.5 text-slate-400 hover:text-slate-600 flex-shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
