/**
 * @module components/NormalizationDialog
 * @description
 * 智能标注元件弹窗 — 展示匹配结果，支持逐条接受/拒绝和多候选歧义选择。
 *
 * 架构设计意图：
 * - 统一展示 smartAnnotateComponents 的匹配结果
 * - 对有多个候选的匹配项提供单选控件（radio button），让用户选择正确的元件
 * - 对 query_coverage < 50% 的匹配显示“部分匹配”警告，帮助用户识别
 * - onAccept 回调返回用户最终确认的 SmartMatchResult[]（含候选替换）
 *
 * 候选选择交互：
 * - 默认选中综合评分最高的匹配（由后端按 similarity*0.6 + query_coverage*0.4 排序）
 * - 展开候选列表后，用 radio button 切换
 * - 选择候选后自动更新 match_component_id/name/type
 * - 候选列表中 query_coverage < 50% 的项显示橙色“部分匹配 X%”警告
 *
 * 依赖关系：
 * - shared/types: SmartMatchResult, SmartMatchCandidate
 */

import { useState, useMemo, useEffect } from 'react'
import { X, Check, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import type { SmartMatchResult, SmartMatchCandidate } from '../../shared/types'

const TYPE_LABELS: Record<string, string> = {
  resistance: '抗性基因', CDS: '编码序列', promoter: '启动子',
  origin: '复制子', terminator: '终止子', enhancer: '增强子',
  reporter: '报告基因', tag: '标签序列', regulatory: '调控元件', other: '其他'
}

const ALIGNMENT_MODE_LABELS: Record<string, { label: string; color: string }> = {
  'nt-nt': { label: '核酸↔核酸', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  'nt-aa': { label: '核酸↔氨基酸', color: 'text-purple-600 bg-purple-50 border-purple-200' },
  'aa-nt': { label: '氨基酸↔核酸', color: 'text-orange-600 bg-orange-50 border-orange-200' },
  'name-match': { label: '名称推断', color: 'text-slate-600 bg-slate-50 border-slate-200' }
}

interface Props {
  matches: SmartMatchResult[]
  vectorName: string
  onAccept: (accepted: SmartMatchResult[]) => void
  onClose: () => void
}

/** 综合评分：similarity * 0.6 + query_coverage * 0.4 */
function compositeScore(similarity: number, queryCoverage: number | undefined): number {
  const qc = queryCoverage != null && queryCoverage > 0 ? queryCoverage : 100
  return Math.round((similarity * 0.6 + qc * 0.4) * 10) / 10
}

/** 智能标注元件弹窗 */
export default function NormalizationDialog({ matches, vectorName, onAccept, onClose }: Props) {
  // 每项是否被用户选中接受
  const [accepted, setAccepted] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {}
    matches.forEach((m, i) => { init[i] = true })  // 默认全部接受
    return init
  })

  // 候选选择：match index → 选中的 component_id（默认为当前匹配的 component_id）
  const [selections, setSelections] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {}
    matches.forEach((m, i) => { init[i] = m.match_component_id })
    return init
  })

  // 展开状态：哪些 match 的候选列表被展开
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  // ESC 键关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  /** 构建最终结果：应用用户的选择替换，完整传递所有坐标字段 */
  const finalMatches = useMemo(() => {
    return matches.filter((_, i) => accepted[i]).map((m, _idx) => {
      const i = matches.indexOf(m)
      const selectedId = selections[i]
      if (selectedId === m.match_component_id) return m
      // 用户选择了其他候选，完整替换所有字段
      const candidate = m.candidates?.find(c => c.component_id === selectedId)
      if (!candidate) return m
      return {
        ...m,
        match_component_id: candidate.component_id,
        match_component_name: candidate.standard_name,
        component_type: candidate.component_type as SmartMatchResult['component_type'],
        similarity: candidate.similarity,
        alignment_mode: candidate.alignment_mode as SmartMatchResult['alignment_mode'],
        tags: candidate.tags || m.tags,
        // 传递坐标和覆盖度字段
        match_start: candidate.match_start ?? m.match_start,
        match_end: candidate.match_end ?? m.match_end,
        query_coverage: candidate.query_coverage ?? m.query_coverage,
        component_match_start: candidate.component_match_start ?? m.component_match_start,
        component_match_end: candidate.component_match_end ?? m.component_match_end,
      }
    })
  }, [matches, accepted, selections])

  const toggle = (i: number) => setAccepted(prev => ({ ...prev, [i]: !prev[i] }))
  const acceptAll = () => { const all: Record<number, boolean> = {}; matches.forEach((_, i) => { all[i] = true }); setAccepted(all) }
  const rejectAll = () => { const all: Record<number, boolean> = {}; matches.forEach((_, i) => { all[i] = false }); setAccepted(all) }

  const selectCandidate = (matchIdx: number, componentId: number) => {
    setSelections(prev => ({ ...prev, [matchIdx]: componentId }))
  }

  const toggleExpand = (i: number) => setExpanded(prev => ({ ...prev, [i]: !prev[i] }))

  return (
    <div className="fixed inset-0 z-[99998] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[620px] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-emerald-500" />
            <h3 className="text-sm font-bold text-slate-800">智能标注元件</h3>
            <span className="text-[10px] text-slate-400">nt-nt ≥99% / nt-aa ≥90%</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          <p className="text-xs text-slate-500 mb-2">
            载体 <span className="font-bold text-slate-700">{vectorName}</span> 中找到 {matches.length} 个高相似度元件匹配。
            选择要应用的标注：
          </p>

          <div className="flex gap-2 mb-2">
            <button onClick={acceptAll} className="px-2 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 rounded border border-emerald-200 hover:bg-emerald-100">
              全部接受
            </button>
            <button onClick={rejectAll} className="px-2 py-0.5 text-[10px] bg-slate-50 text-slate-500 rounded border border-slate-200 hover:bg-slate-100">
              全部拒绝
            </button>
          </div>

          <div className="space-y-1.5">
            {matches.map((m, i) => {
              const isAccepted = accepted[i]
              const selectedId = selections[i]
              const hasCandidates = m.candidates && m.candidates.length > 0
              const isExpanded = expanded[i]
              const needsRename = m.feature_name && m.feature_name !== m.match_component_name
              const mode = ALIGNMENT_MODE_LABELS[m.alignment_mode] || { label: m.alignment_mode, color: 'text-slate-500 bg-slate-50 border-slate-200' }

              // 构建完整候选列表（当前匹配 + candidates）
              const allCandidates: Array<{ component_id: number; standard_name: string; similarity: number; component_type: string; alignment_mode: string; tags?: string; query_coverage?: number; match_start?: number; match_end?: number; component_seq_length?: number; component_match_start?: number; component_match_end?: number }> = [
                { component_id: m.match_component_id, standard_name: m.match_component_name, similarity: m.similarity, component_type: m.component_type, alignment_mode: m.alignment_mode, tags: m.tags, query_coverage: m.query_coverage, match_start: m.match_start, match_end: m.match_end, component_seq_length: m.query_coverage != null && m.query_coverage > 0 ? Math.round((m.match_end - m.match_start) / (m.query_coverage / 100)) : (m.match_end - m.match_start), component_match_start: m.component_match_start, component_match_end: m.component_match_end },
                ...(m.candidates || [])
              ]

              return (
                <div key={i} className={`rounded border transition-colors ${isAccepted ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-100 bg-slate-50'}`}>
                  {/* 主行 */}
                  <div
                    onClick={() => toggle(i)}
                    className="flex items-start gap-2 px-2 py-1.5 cursor-pointer"
                  >
                    <input type="checkbox" checked={isAccepted} onChange={() => toggle(i)}
                      className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs font-medium ${TYPE_LABELS[m.component_type] ? 'text-slate-500' : 'text-slate-400'}`}>
                          [{TYPE_LABELS[m.component_type] || m.component_type}]
                        </span>
                        {needsRename ? (
                          <>
                            <span className="text-xs text-slate-400 line-through">{m.feature_name}</span>
                            <span className="text-xs text-emerald-600">→</span>
                            <span className="text-xs font-bold text-emerald-700">
                              {allCandidates.find(c => c.component_id === selectedId)?.standard_name || m.match_component_name}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs font-bold text-slate-700">
                            {allCandidates.find(c => c.component_id === selectedId)?.standard_name || m.match_component_name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {/* 综合评分 */}
                        <span className="text-[10px] font-bold px-1 rounded text-violet-700 bg-violet-50" title="综合评分 = 相似度×0.6 + 覆盖度×0.4">
                          综合{compositeScore(m.similarity, m.query_coverage)}
                        </span>
                        {/* 相似度百分比 */}
                        {m.similarity >= 0 ? (
                          <span className={`text-[10px] font-bold px-1 rounded ${m.similarity >= 100 ? 'text-emerald-700 bg-emerald-100' : m.similarity >= 99 ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50'}`}>
                            {m.similarity}%
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-1 rounded text-slate-500 bg-slate-100">
                            仅名称
                          </span>
                        )}
                        {/* 覆盖度指标 */}
                        {m.query_coverage != null && m.query_coverage > 0 && m.query_coverage < 100 && (
                          <span className={`text-[10px] font-bold px-1 rounded ${m.query_coverage >= 90 ? 'text-sky-600 bg-sky-50' : 'text-orange-600 bg-orange-50'}`}>
                            覆盖{m.query_coverage}%
                          </span>
                        )}
                        {/* 比对模式标签 */}
                        <span className={`text-[10px] px-1 rounded border ${mode.color}`}>
                          {mode.label}
                        </span>
                        {/* 匹配类型 */}
                        <span className={`text-[10px] ${m.match_type === 'exact' ? 'text-emerald-500' : 'text-amber-500'}`}>
                          {m.match_type === 'exact' ? '完全匹配' : '部分匹配'}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono" title="载体上的匹配位置">
                          载体 {m.match_start}-{m.match_end} ({m.strand === 1 ? '+' : '-'})
                        </span>
                        {/* 载体匹配长度 */}
                        {m.match_end > m.match_start && (
                          <span className="text-[10px] text-slate-500">
                            {m.match_end - m.match_start}bp
                          </span>
                        )}
                        {/* 元件匹配范围 */}
                        {m.component_match_start != null && m.component_match_end != null && (
                          <span className="text-[10px] text-blue-600 font-mono" title="元件序列上的匹配范围">
                            元件匹配 {m.component_match_start}-{m.component_match_end} ({m.component_match_end - m.component_match_start + 1}bp)
                          </span>
                        )}
                        {/* 候选数量指示 */}
                        {hasCandidates && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleExpand(i) }}
                            className="text-[10px] text-violet-600 bg-violet-50 border border-violet-200 rounded px-1 py-0 flex items-center gap-0.5 hover:bg-violet-100"
                          >
                            {allCandidates.length}个候选 {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                          </button>
                        )}
                      </div>
                      {/* 部分匹配提示：当 query_coverage < 50% 时显示警告 */}
                      {m.partial_match_note && (
                        <div className="mt-0.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5" title={m.partial_match_note}>
                          ⚠ {m.partial_match_note}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 候选选择区域 */}
                  {hasCandidates && isExpanded && (
                    <div className="px-2 pb-2 pt-0.5 border-t border-slate-100 ml-6">
                      <p className="text-[10px] text-slate-400 mb-1">选择正确的元件：</p>
                      <div className="space-y-0.5">
                        {allCandidates.map((cand, ci) => {
                          const candRange = cand.match_start != null && cand.match_end != null ? `${cand.match_start}-${cand.match_end}` : null
                          const candLen = cand.match_start != null && cand.match_end != null ? cand.match_end - cand.match_start : null
                          return (
                          <label
                            key={cand.component_id}
                            className={`flex flex-col gap-0.5 px-1.5 py-1 rounded cursor-pointer text-[11px] transition-colors
                              ${selectedId === cand.component_id ? 'bg-violet-50 border border-violet-200' : 'hover:bg-slate-50 border border-transparent'}`}
                          >
                            <div className="flex items-center gap-1.5">
                              <input
                                type="radio"
                                name={`candidate-${i}`}
                                checked={selectedId === cand.component_id}
                                onChange={() => selectCandidate(i, cand.component_id)}
                                className="w-3 h-3 text-violet-600 focus:ring-violet-500"
                              />
                              <span className="text-[10px] text-slate-500">[{TYPE_LABELS[cand.component_type] || cand.component_type}]</span>
                              <span className={`font-medium ${selectedId === cand.component_id ? 'text-violet-700' : 'text-slate-700'}`}>
                                {cand.standard_name}
                              </span>
                              <span className={`text-[10px] font-bold px-1 rounded ${cand.similarity >= 99 ? 'text-emerald-600 bg-emerald-50' : cand.similarity >= 90 ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-100'}`}>
                                {cand.similarity}%
                              </span>
                              {/* 综合评分 */}
                              <span className="text-[9px] font-bold px-1 rounded text-violet-700 bg-violet-50" title="综合评分 = 相似度×0.6 + 覆盖度×0.4">
                                综合{compositeScore(cand.similarity, cand.query_coverage)}
                              </span>
                              <span className={`text-[9px] px-1 rounded border ${ALIGNMENT_MODE_LABELS[cand.alignment_mode]?.color || 'text-slate-500 bg-slate-50 border-slate-200'}`}>
                                {ALIGNMENT_MODE_LABELS[cand.alignment_mode]?.label || cand.alignment_mode}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 ml-[18px] flex-wrap">
                              {/* 载体匹配区间 */}
                              {candRange && (
                                <span className="text-[9px] text-slate-400 font-mono" title="载体上的匹配位置">
                                  载体 {candRange} ({candLen}bp)
                                </span>
                              )}
                              {/* 元件总长度 */}
                              {cand.component_seq_length != null && cand.component_seq_length > 0 && (
                                <span className="text-[9px] text-slate-500" title="元件数据库中的完整长度">
                                  元件{cand.component_seq_length}bp
                                </span>
                              )}
                              {/* 元件匹配范围 */}
                              {cand.component_match_start != null && cand.component_match_end != null && (
                                <span className="text-[9px] text-blue-600 font-mono" title="元件序列上的匹配范围">
                                  匹配{cand.component_match_start}-{cand.component_match_end} ({cand.component_match_end - cand.component_match_start + 1}bp)
                                </span>
                              )}
                              {/* 覆盖度 */}
                              {cand.query_coverage != null && cand.query_coverage > 0 && (
                                <span className={`text-[9px] font-bold px-1 rounded ${cand.query_coverage >= 90 ? 'text-sky-600 bg-sky-50' : cand.query_coverage >= 50 ? 'text-amber-600 bg-amber-50' : 'text-orange-700 bg-orange-50 border border-orange-200'}`}>
                                  覆盖{Math.round(cand.query_coverage)}%
                                </span>
                              )}
                              {/* 部分匹配警告 */}
                              {cand.query_coverage != null && cand.query_coverage > 0 && cand.query_coverage < 50 && (
                                <span className="text-[9px] text-orange-600">
                                  ⚠ 仅匹配部分序列
                                </span>
                              )}
                            </div>
                          </label>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <span className="text-[10px] text-slate-400">
            已选择 {finalMatches.length}/{matches.length} 项
          </span>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded hover:bg-slate-100">
              取消
            </button>
            <button
              onClick={() => onAccept(finalMatches)}
              disabled={finalMatches.length === 0}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check size={12} /> 应用标注
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
