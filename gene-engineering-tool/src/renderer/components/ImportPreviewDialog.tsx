/**
 * @module components/ImportPreviewDialog
 * @description
 * 批量导入元件预览弹窗 — 展示预扫描结果，支持用户逐条决策。
 *
 * 状态分类：
 * - new：数据库中没有匹配，可直接新建
 * - duplicate：与已有元件高度相似（≥95%），将被跳过
 * - variant：与已有元件中度相似（60-95%），可作为变体关联或新建
 * - ambiguous：有多个候选匹配，需用户选择
 *
 * 依赖关系：
 * - shared/types: ImportPreviewItem, ImportDecision
 */

import { useState, useMemo, useEffect } from 'react'
import { X, Check, Database, ChevronDown, ChevronUp } from 'lucide-react'
import type { ImportPreviewItem, ImportDecision } from '../../shared/types'

const STATUS_CONFIG = {
  new: { label: '新建', color: 'text-blue-600 bg-blue-50 border-blue-200', icon: '➕' },
  duplicate: { label: '重复', color: 'text-slate-500 bg-slate-50 border-slate-200', icon: '✓' },
  variant: { label: '变体', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: '🔗' },
  ambiguous: { label: '歧义', color: 'text-purple-600 bg-purple-50 border-purple-200', icon: '❓' }
}

const FEATURE_TYPE_LABELS: Record<string, string> = {
  gene: '基因', CDS: '编码序列', mRNA: 'mRNA',
  promoter: '启动子', rep_origin: '复制起点',
  terminator: '终止子', enhancer: '增强子',
  misc_feature: '其他', primer_bind: '引物结合',
  source: '来源', regulatory: '调控'
}

interface Props {
  items: ImportPreviewItem[]
  vectorName: string
  isLoading: boolean
  onConfirm: (decisions: ImportDecision[]) => void
  onClose: () => void
}

export default function ImportPreviewDialog({ items, vectorName, isLoading, onConfirm, onClose }: Props) {
  // 每项的用户决策
  const [decisions, setDecisions] = useState<Record<number, ImportDecision>>(() => {
    const init: Record<number, ImportDecision> = {}
    items.forEach(item => {
      switch (item.status) {
        case 'new':
          init[item.featureIndex] = { featureIndex: item.featureIndex, action: 'import-new' }
          break
        case 'duplicate':
          init[item.featureIndex] = { featureIndex: item.featureIndex, action: 'skip' }
          break
        case 'variant':
          init[item.featureIndex] = { featureIndex: item.featureIndex, action: 'import-as-variant', variantOfComponentId: item.matchComponentId }
          break
        case 'ambiguous':
          init[item.featureIndex] = { featureIndex: item.featureIndex, action: 'import-new' }
          break
      }
    })
    return init
  })

  // 展开状态
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const updateDecision = (featureIndex: number, action: ImportDecision['action'], extra?: Partial<ImportDecision>) => {
    setDecisions(prev => ({
      ...prev,
      [featureIndex]: { featureIndex, action, ...extra }
    }))
  }

  const toggleExpand = (fi: number) => setExpanded(prev => ({ ...prev, [fi]: !prev[fi] }))

  // 统计
  const stats = useMemo(() => {
    let newCount = 0, skipCount = 0, variantCount = 0
    for (const d of Object.values(decisions)) {
      if (d.action === 'import-new') newCount++
      else if (d.action === 'skip') skipCount++
      else variantCount++
    }
    return { newCount, skipCount, variantCount }
  }, [decisions])

  const handleConfirm = () => {
    const decisionList = Object.values(decisions).filter(d => {
      const item = items.find(i => i.featureIndex === d.featureIndex)
      return item // 只提交有对应 feature 的决策
    })
    onConfirm(decisionList)
  }

  return (
    <div className="fixed inset-0 z-[99998] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[720px] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-amber-500" />
            <h3 className="text-sm font-bold text-slate-800">批量导入元件预览</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-amber-400 border-t-transparent" />
              <span className="ml-2 text-sm text-slate-500">正在扫描元件数据库...</span>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-2">
                载体 <span className="font-bold text-slate-700">{vectorName}</span> 中检测到 {items.length} 个元件。
                请确认导入方式：
              </p>

              <div className="flex gap-3 mb-3 text-[10px]">
                <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                  新建: {items.filter(i => i.status === 'new').length}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-200">
                  重复: {items.filter(i => i.status === 'duplicate').length}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                  变体: {items.filter(i => i.status === 'variant').length}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-200">
                  歧义: {items.filter(i => i.status === 'ambiguous').length}
                </span>
              </div>

              <div className="space-y-1.5">
                {items.map(item => {
                  const dec = decisions[item.featureIndex]
                  const isExpanded = expanded[item.featureIndex]
                  const cfg = STATUS_CONFIG[item.status]

                  return (
                    <div key={item.featureIndex} className={`rounded border ${dec?.action === 'skip' ? 'border-slate-100 bg-slate-50/50 opacity-60' : 'border-slate-200 bg-white'}`}>
                      {/* 主行 */}
                      <div className="flex items-start gap-2 px-2.5 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* 状态标签 */}
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${cfg.color}`}>
                              {cfg.icon} {cfg.label}
                            </span>
                            {/* Feature 类型 */}
                            <span className="text-[10px] text-slate-400">
                              [{FEATURE_TYPE_LABELS[item.type] || item.type}]
                            </span>
                            {/* 名称 */}
                            <span className="text-xs font-medium text-slate-700">{item.name}</span>
                            {/* 长度 */}
                            <span className="text-[10px] text-slate-400 font-mono">{item.dnaLength}bp</span>
                            {item.aaLength > 0 && (
                              <span className="text-[10px] text-slate-400 font-mono">({item.aaLength}aa)</span>
                            )}
                            {/* 链方向 */}
                            <span className={`text-[10px] ${item.strand === -1 ? 'text-rose-500' : 'text-slate-400'}`}>
                              {item.strand === -1 ? '(−)' : '(+)'}
                            </span>
                          </div>

                          {/* 匹配信息 */}
                          {item.matchComponentName && (
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <span className="text-[10px] text-slate-500">
                                匹配: <span className="font-medium text-slate-600">{item.matchComponentName}</span>
                              </span>
                              {item.dnaIdentity != null && item.dnaIdentity > 0 && (
                                <span className={`text-[10px] font-bold px-1 rounded ${item.dnaIdentity >= 95 ? 'text-emerald-600 bg-emerald-50' : item.dnaIdentity >= 80 ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-100'}`}>
                                  DNA {item.dnaIdentity}%
                                </span>
                              )}
                              {item.aaIdentity != null && item.aaIdentity > 0 && (
                                <span className={`text-[10px] font-bold px-1 rounded ${item.aaIdentity >= 95 ? 'text-emerald-600 bg-emerald-50' : item.aaIdentity >= 70 ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-100'}`}>
                                  AA {item.aaIdentity}%
                                </span>
                              )}
                              {item.alignmentMode && (
                                <span className={`text-[10px] px-1 rounded border ${item.alignmentMode === 'nt-nt' ? 'text-blue-600 bg-blue-50 border-blue-200' : 'text-purple-600 bg-purple-50 border-purple-200'}`}>
                                  {item.alignmentMode === 'nt-nt' ? '核酸↔核酸' : '核酸↔氨基酸'}
                                </span>
                              )}
                            </div>
                          )}

                          {/* 跳过原因 */}
                          {item.skipReason && dec?.action === 'skip' && (
                            <div className="mt-1 text-[10px] text-slate-500 italic">{item.skipReason}</div>
                          )}
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {item.status === 'new' && (
                            <button
                              onClick={() => updateDecision(item.featureIndex, 'import-new')}
                              className={`text-[10px] px-2 py-0.5 rounded border ${dec?.action === 'import-new' ? 'bg-blue-500 text-white border-blue-500' : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'}`}
                            >
                              新建导入
                            </button>
                          )}
                          {(item.status === 'duplicate' || item.status === 'variant') && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => updateDecision(item.featureIndex, 'skip')}
                                className={`text-[10px] px-2 py-0.5 rounded border ${dec?.action === 'skip' ? 'bg-slate-400 text-white border-slate-400' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                              >
                                跳过
                              </button>
                              {item.status === 'variant' && (
                                <button
                                  onClick={() => updateDecision(item.featureIndex, 'import-as-variant', { variantOfComponentId: item.matchComponentId })}
                                  className={`text-[10px] px-2 py-0.5 rounded border ${dec?.action === 'import-as-variant' ? 'bg-amber-500 text-white border-amber-500' : 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100'}`}
                                >
                                  关联变体
                                </button>
                              )}
                              <button
                                onClick={() => updateDecision(item.featureIndex, 'import-new')}
                                className={`text-[10px] px-2 py-0.5 rounded border ${dec?.action === 'import-new' ? 'bg-blue-500 text-white border-blue-500' : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'}`}
                              >
                                新建
                              </button>
                            </div>
                          )}
                          {item.status === 'ambiguous' && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => updateDecision(item.featureIndex, 'skip')}
                                className={`text-[10px] px-2 py-0.5 rounded border ${dec?.action === 'skip' ? 'bg-slate-400 text-white border-slate-400' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                              >
                                跳过
                              </button>
                              <button
                                onClick={() => updateDecision(item.featureIndex, 'import-new')}
                                className={`text-[10px] px-2 py-0.5 rounded border ${dec?.action === 'import-new' ? 'bg-blue-500 text-white border-blue-500' : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'}`}
                              >
                                新建
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleExpand(item.featureIndex) }}
                                className="text-[10px] text-purple-600 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5 flex items-center gap-0.5 hover:bg-purple-100"
                              >
                                选择元件 {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 候选选择区域（ambiguous） */}
                      {item.status === 'ambiguous' && isExpanded && item.candidates && (
                        <div className="px-3 pb-2 pt-0.5 border-t border-slate-100 ml-4">
                          <p className="text-[10px] text-slate-400 mb-1">关联到已有元件（作为变体）：</p>
                          <div className="space-y-0.5">
                            {item.candidates.map(cand => (
                              <label
                                key={cand.componentId}
                                className={`flex flex-col gap-0.5 px-2 py-1 rounded cursor-pointer text-[11px] transition-colors
                                  ${dec?.action === 'import-as-variant-of' && dec.variantOfComponentId === cand.componentId ? 'bg-purple-50 border border-purple-200' : 'hover:bg-slate-50 border border-transparent'}`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="radio"
                                    name={`candidate-${item.featureIndex}`}
                                    checked={dec?.action === 'import-as-variant-of' && dec.variantOfComponentId === cand.componentId}
                                    onChange={() => updateDecision(item.featureIndex, 'import-as-variant-of', { variantOfComponentId: cand.componentId, overrideName: item.name })}
                                    className="w-3 h-3 text-purple-600 focus:ring-purple-500"
                                  />
                                  <span className="text-[10px] text-slate-500">[{cand.componentType}]</span>
                                  <span className={`font-medium ${dec?.variantOfComponentId === cand.componentId ? 'text-purple-700' : 'text-slate-700'}`}>
                                    {cand.componentName}
                                  </span>
                                  <span className={`text-[10px] font-bold px-1 rounded ${cand.dnaIdentity >= 90 ? 'text-emerald-600 bg-emerald-50' : cand.dnaIdentity >= 70 ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-100'}`}>
                                    DNA {cand.dnaIdentity}%
                                  </span>
                                  {cand.aaIdentity > 0 && (
                                    <span className={`text-[10px] font-bold px-1 rounded ${cand.aaIdentity >= 80 ? 'text-emerald-600 bg-emerald-50' : cand.aaIdentity >= 60 ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-100'}`}>
                                      AA {cand.aaIdentity}%
                                    </span>
                                  )}
                                  <span className={`text-[9px] px-1 rounded border ${cand.alignmentMode === 'nt-nt' ? 'text-blue-600 bg-blue-50 border-blue-200' : 'text-purple-600 bg-purple-50 border-purple-200'}`}>
                                    {cand.alignmentMode === 'nt-nt' ? '核酸↔核酸' : '核酸↔氨基酸'}
                                  </span>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <div className="flex gap-3 text-[10px] text-slate-500">
            <span>新建: {stats.newCount}</span>
            <span>跳过: {stats.skipCount}</span>
            <span>变体: {stats.variantCount}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded hover:bg-slate-100">
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={isLoading || (stats.newCount === 0 && stats.variantCount === 0)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-amber-600 text-white rounded hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check size={12} /> 确认导入
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
