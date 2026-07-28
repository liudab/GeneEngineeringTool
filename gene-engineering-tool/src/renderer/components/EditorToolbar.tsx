import { memo } from 'react'
import { Save, Circle, Minus, EyeOff } from 'lucide-react'

interface Props {
  vectorName: string
  seqMode: 'nucleotide' | 'protein'
  species?: string
  sizeBp: number
  viewMode: 'circular' | 'linear'
  topologyLabel: string
  circularLabel: string
  linearLabel: string
  saveLabel: string
  unsavedLabel: string
  hiddenCount: number
  dirty: boolean
  saveMsg: string
  onSetViewMode: (mode: 'circular' | 'linear') => void
  onSave: () => void
}

/** 精简顶栏 — memo 隔离，仅在核心 props 变化时重渲染 */
const EditorToolbar = memo(function EditorToolbar({
  vectorName, seqMode, species, sizeBp, viewMode, topologyLabel,
  circularLabel, linearLabel, saveLabel, unsavedLabel,
  hiddenCount, dirty, saveMsg, onSetViewMode, onSave
}: Props) {
  return (
    <header className="relative z-40 h-10 bg-white border-b border-slate-200 flex items-center px-3 flex-shrink-0 gap-2">
      <h1 className="text-sm font-bold text-slate-800 truncate max-w-[200px]">{vectorName}</h1>
      <span className={`px-1.5 py-0.5 text-[10px] rounded ${seqMode === 'protein' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
        {seqMode === 'protein' ? 'Protein' : 'Nucl'}
      </span>
      {species && <span className="text-xs text-slate-400 italic truncate max-w-[120px]">{species}</span>}
      <span className="text-xs text-slate-400">{sizeBp?.toLocaleString()} {seqMode === 'protein' ? 'aa' : 'bp'}</span>
      <span className={`px-1.5 py-0.5 text-[10px] rounded ${viewMode === 'circular' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
        {topologyLabel}
      </span>
      <div className="w-px h-5 bg-slate-200" />
      <div className="flex border border-slate-200 rounded overflow-hidden">
        <button onClick={() => onSetViewMode('circular')}
          className={`px-2 py-0.5 text-xs flex items-center gap-1 ${viewMode === 'circular' ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          <Circle size={12} /> {circularLabel}
        </button>
        <button onClick={() => onSetViewMode('linear')}
          className={`px-2 py-0.5 text-xs flex items-center gap-1 ${viewMode === 'linear' ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          <Minus size={12} /> {linearLabel}
        </button>
      </div>
      {hiddenCount > 0 && (
        <span className="text-[10px] text-amber-600 flex items-center gap-1"><EyeOff size={10} />{hiddenCount}隐藏</span>
      )}
      <div className="flex-1" />
      {dirty && <span className="text-xs text-amber-500">{unsavedLabel}</span>}
      {saveMsg && <span className="text-xs text-green-600">{saveMsg}</span>}
      <button onClick={onSave}
        className="px-3 py-1 bg-green-600 text-white rounded text-xs flex items-center gap-1 hover:bg-green-500">
        <Save size={12} /> {saveLabel}
      </button>
    </header>
  )
})

export default EditorToolbar
