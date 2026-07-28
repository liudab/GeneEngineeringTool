import { useEffect, useState, useRef } from 'react'
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

interface Props {
  dirty: boolean
  saving?: boolean
  lastSavedAt?: number | null
  onSave?: () => void
}

/**
 * 保存状态指示器
 * - 绿点 + "已保存" — 无未保存修改
 * - 橙点 + "未保存" — 有修改待保存
 * - 旋转 + "保存中..." — 正在保存
 * - 点击手动保存
 */
export default function SaveIndicator({ dirty, saving, lastSavedAt, onSave }: Props) {
  const [showSaved, setShowSaved] = useState(false)
  const prevDirty = useRef(dirty)

  // 检测 dirty → !dirty 的切换，显示"已保存"动画
  useEffect(() => {
    if (prevDirty.current && !dirty) {
      setShowSaved(true)
      const t = setTimeout(() => setShowSaved(false), 2000)
      return () => clearTimeout(t)
    }
    prevDirty.current = dirty
  }, [dirty])

  const handleClick = () => {
    if (!saving && dirty && onSave) onSave()
  }

  const timeStr = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <button
      onClick={handleClick}
      disabled={!dirty || saving}
      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all
        ${saving ? 'text-blue-500' :
          dirty ? 'text-amber-600 hover:bg-amber-50 cursor-pointer' :
          showSaved ? 'text-emerald-600' :
          'text-slate-400 cursor-default'
        }`}
      title={dirty ? '点击保存 (Ctrl+S)' : timeStr ? `上次保存: ${timeStr}` : '已保存'}
    >
      {saving ? (
        <Loader2 size={12} className="animate-spin" />
      ) : showSaved ? (
        <CheckCircle2 size={12} />
      ) : dirty ? (
        <AlertCircle size={12} />
      ) : (
        <CheckCircle2 size={12} />
      )}
      <span>
        {saving ? '保存中...' : showSaved ? '已保存' : dirty ? '未保存' : '已保存'}
      </span>
      {timeStr && !dirty && !saving && !showSaved && (
        <span className="text-slate-300 text-[10px]">{timeStr}</span>
      )}
    </button>
  )
}
