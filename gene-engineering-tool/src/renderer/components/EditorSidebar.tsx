import { memo, useState, useCallback } from 'react'
import {
  List, Settings, Sliders, Sparkles, Database, Pipette, AlignLeft,
  Globe, Activity, FlaskConical, Scissors, Beaker, GitBranch,
  ChevronLeft, ChevronRight
} from 'lucide-react'

export type ActivePanel = 'none' | 'primer' | 'cloning' | 'protein' | 'msa' | 'digest' | 'extClone' | 'blast'

interface SidebarItem {
  id: string
  icon: React.ReactNode
  label: string
  action: () => void
  active?: boolean
  disabled?: boolean
  /** 仅核酸模式显示 */
  nuclOnly?: boolean
  /** 仅调试模式显示 */
  debugOnly?: boolean
}

interface Props {
  seqMode: 'nucleotide' | 'protein'
  debugMode: boolean
  activePanel: ActivePanel
  showFeatureList: boolean
  showUnifiedSettings: boolean
  showEnzymeSettings: boolean
  smartAnnotationLoading: boolean
  smartAnnotationProgress: number | null
  primerScanLoading: boolean
  primerSitesCount: number
  showAlignmentDrawer: boolean
  // 回调
  onToggleFeatureList: () => void
  onToggleSettings: () => void
  onToggleEnzymeSettings: () => void
  onSmartAnnotate: () => void
  onBatchImport: () => void
  onPrimerScan: () => void
  onToggleAlignment: () => void
  onTogglePanel: (panel: ActivePanel) => void
}

/** 左侧可折叠工具侧边栏 — memo 隔离，不随主组件高频 re-render */
const EditorSidebar = memo(function EditorSidebar({
  seqMode, debugMode, activePanel, showFeatureList, showUnifiedSettings, showEnzymeSettings,
  smartAnnotationLoading, smartAnnotationProgress, primerScanLoading, primerSitesCount, showAlignmentDrawer,
  onToggleFeatureList, onToggleSettings, onToggleEnzymeSettings,
  onSmartAnnotate, onBatchImport, onPrimerScan, onToggleAlignment, onTogglePanel
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const toggleExpanded = useCallback(() => setExpanded(e => !e), [])

  const isNucl = seqMode === 'nucleotide'

  // 视图分组
  const viewItems: SidebarItem[] = [
    { id: 'features', icon: <List size={16} />, label: '元件列表', action: onToggleFeatureList, active: showFeatureList },
    { id: 'settings', icon: <Settings size={16} />, label: '样式设置', action: onToggleSettings, active: showUnifiedSettings },
    { id: 'enzyme', icon: <Sliders size={16} />, label: '酶切设置', action: onToggleEnzymeSettings, active: showEnzymeSettings, nuclOnly: true },
  ]

  // 分析分组
  const analysisItems: SidebarItem[] = [
    { id: 'annotate', icon: <Sparkles size={16} />, label: smartAnnotationLoading ? (smartAnnotationProgress != null ? `${Math.round(smartAnnotationProgress)}%` : '识别中') : '智能标注', action: onSmartAnnotate, disabled: smartAnnotationLoading, nuclOnly: true },
    { id: 'primerScan', icon: <Pipette size={16} />, label: primerScanLoading ? '比对中' : primerSitesCount > 0 ? `引物扫描(${primerSitesCount})` : '引物扫描', action: onPrimerScan, disabled: primerScanLoading, active: primerSitesCount > 0, nuclOnly: true },
    { id: 'align', icon: <AlignLeft size={16} />, label: '序列比对', action: onToggleAlignment, active: showAlignmentDrawer },
    { id: 'blast', icon: <Globe size={16} />, label: 'BLAST', action: () => onTogglePanel('blast'), active: activePanel === 'blast' },
    { id: 'protein', icon: <Activity size={16} />, label: '蛋白分析', action: () => onTogglePanel('protein'), active: activePanel === 'protein' },
    { id: 'msa', icon: <GitBranch size={16} />, label: '多序列比对', action: () => onTogglePanel('msa'), active: activePanel === 'msa' },
  ]

  // 克隆分组
  const cloningItems: SidebarItem[] = [
    { id: 'primer', icon: <FlaskConical size={16} />, label: '引物设计', action: () => onTogglePanel('primer'), active: activePanel === 'primer', nuclOnly: true },
    { id: 'cloning', icon: <Scissors size={16} />, label: '基础克隆', action: () => onTogglePanel('cloning'), active: activePanel === 'cloning', nuclOnly: true },
    { id: 'digest', icon: <Beaker size={16} />, label: '模拟酶切', action: () => onTogglePanel('digest'), active: activePanel === 'digest', nuclOnly: true },
    { id: 'extClone', icon: <Sparkles size={16} />, label: '高级克隆', action: () => onTogglePanel('extClone'), active: activePanel === 'extClone', nuclOnly: true },
  ]

  // 调试分组
  const debugItems: SidebarItem[] = [
    { id: 'import', icon: <Database size={16} />, label: '导入元件', action: onBatchImport, debugOnly: true },
  ]

  const filterItems = (items: SidebarItem[]) =>
    items.filter(it => {
      if (it.nuclOnly && !isNucl) return false
      if (it.debugOnly && !debugMode) return false
      return true
    })

  const groups: { label: string; items: SidebarItem[] }[] = [
    { label: '视图', items: filterItems(viewItems) },
    { label: '分析', items: filterItems(analysisItems) },
    { label: '克隆', items: filterItems(cloningItems) },
  ]
  if (debugMode) {
    groups.push({ label: '调试', items: filterItems(debugItems) })
  }

  return (
    <div
      className={`relative z-30 flex flex-col bg-white border-r border-slate-200 flex-shrink-0 transition-[width] duration-150 overflow-hidden ${expanded ? 'w-[180px]' : 'w-[44px]'}`}
    >
      {/* 展开/折叠按钮 */}
      <button
        onClick={toggleExpanded}
        className="flex items-center justify-center h-8 border-b border-slate-100 text-slate-400 hover:text-slate-600 hover:bg-slate-50 flex-shrink-0"
        title={expanded ? '折叠侧边栏' : '展开侧边栏'}
      >
        {expanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>

      {/* 分组按钮列表 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {groups.map(group => (
          <div key={group.label} className="mb-1">
            {expanded && (
              <div className="px-3 py-1 text-[9px] font-semibold text-slate-400 uppercase tracking-wider select-none">
                {group.label}
              </div>
            )}
            {group.items.map(item => (
              <button
                key={item.id}
                onClick={item.action}
                disabled={item.disabled}
                title={item.label}
                className={`w-full flex items-center gap-2 py-1.5 text-xs transition-colors
                  ${expanded ? 'px-3' : 'px-0 justify-center'}
                  ${item.active
                    ? 'bg-violet-50 text-violet-700 border-r-2 border-violet-500'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'}
                  ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                <span className="flex-shrink-0">{item.icon}</span>
                {expanded && <span className="truncate text-left">{item.label}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
})

export default EditorSidebar
