import { useState, useEffect, useRef } from 'react'
import { Search, Upload, Trash2, Edit2, X, FileText, ArrowRight, ArrowLeft, Maximize2 } from 'lucide-react'
import type { SequencingFile, SequencingDirection, Primer } from '../../shared/types'
import { useI18n } from '../hooks/useI18n'
import { useLifecycleLog, useModuleLogger } from '../hooks/useDebugLog'
import ChromatogramViewer from '../components/ChromatogramViewer/ChromatogramViewer'

export default function SequencingFilePage() {
  useLifecycleLog('SequencingFilePage')
  const log = useModuleLogger('SequencingFilePage')

  const { t } = useI18n()
  const [files, setFiles] = useState<SequencingFile[]>([])
  const [selected, setSelected] = useState<SequencingFile | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showEdit, setShowEdit] = useState(false)
  const [primers, setPrimers] = useState<Primer[]>([])
  const [editData, setEditData] = useState({
    sample_name: '', direction: 'forward' as SequencingDirection,
    primer_id: null as number | null, notes: ''
  })
  const [traceData, setTraceData] = useState<any>(null)
  const [peakPositions, setPeakPositions] = useState<number[]>([])
  const [qualityValues, setQualityValues] = useState<number[]>([])
  const [showFullScreen, setShowFullScreen] = useState(false)
  const [referenceSequence, setReferenceSequence] = useState<string>('')
  const [referenceSource, setReferenceSource] = useState<string>('')
  const fullscreenRef = useRef<HTMLDivElement>(null)
  const [fullscreenH, setFullscreenH] = useState(600)

  useEffect(() => { loadFiles() }, [])

  // 全屏峰图自适应高度
  useEffect(() => {
    if (!showFullScreen) return
    const el = fullscreenRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const h = entry.contentRect.height
        if (h > 100) setFullscreenH(h - 8)
      }
    })
    obs.observe(el)
    setFullscreenH(el.clientHeight - 8)
    return () => obs.disconnect()
  }, [showFullScreen])

  const loadFiles = async () => {
    log.info('Loading sequencing files...')
    try {
      const data = await window.api.getSequencingFiles()
      log.info(`Loaded ${data.length} sequencing files`)
      setFiles(data)
    } catch (err) {
      log.error('Failed to load sequencing files', err)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) { loadFiles(); return }
    console.log(`[SeqFilePage] Searching: "${searchQuery}"`)
    const data = await window.api.searchSequencingFiles(searchQuery)
    console.log(`[SeqFilePage] Search results: ${data.length}`)
    setFiles(data)
  }

  const handleImport = async () => {
    log.info('Importing sequencing files...')
    const result = await window.api.importSequencingFiles()
    if (result?.success && result.count > 0) {
      log.info(`Imported ${result.count} files`)
      loadFiles()
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm(t('dialog.confirmDelete'))) return
    log.info(`Deleting sequencing file id=${id}`)
    await window.api.deleteSequencingFile(id)
    loadFiles()
    if (selected?.id === id) setSelected(null)
  }

  const handleSelect = async (f: SequencingFile) => {
    setSelected(f)
    // 尝试加载色谱数据
    setTraceData(null)
    setPeakPositions([])
    setQualityValues([])
    setReferenceSequence('')
    setReferenceSource('')
    if (f.file_type === 'ab1' && f.id) {
      try {
        const data = await window.api.readSequencingFile(f.id)
        if (data?.trace_data_parsed) {
          setTraceData(data.trace_data_parsed)
          setPeakPositions(data.peak_positions_parsed || [])
          setQualityValues(data.quality_values_parsed || [])
        }
        // 如果后端推导/返回了序列，更新 selected 对象
        if (data?.sequence && !f.sequence) {
          setSelected({ ...f, sequence: data.sequence })
        }
        if (data?.reference_sequence) {
          setReferenceSequence(data.reference_sequence)
          setReferenceSource(data.reference_source || '')
        }
      } catch (e) { log.error('Failed to load trace data', e) }
    }
  }

  const handleEdit = (f: SequencingFile) => {
    setEditData({
      sample_name: f.sample_name,
      direction: f.direction,
      primer_id: f.primer_id,
      notes: f.notes || ''
    })
    // 加载引物列表供选择
    window.api.getPrimers().then(setPrimers)
    setShowEdit(true)
  }

  const handleEditSubmit = async () => {
    if (!selected) return
    await window.api.updateSequencingFile(selected.id, editData)
    setShowEdit(false)
    // 重新加载
    const updated = await window.api.getSequencingFile(selected.id)
    if (updated) setSelected(updated)
    loadFiles()
  }

  const fileTypeLabel = (ft: string) => {
    if (ft === 'ab1') return 'AB1'
    if (ft === 'fasta') return 'FASTA'
    return 'SEQ'
  }

  const fileTypeColor = (ft: string) => {
    if (ft === 'ab1') return 'bg-violet-100 text-violet-700'
    if (ft === 'fasta') return 'bg-blue-100 text-blue-700'
    return 'bg-slate-100 text-slate-600'
  }

  return (
    <div className="flex h-full gap-4">
      {/* 左侧列表 */}
      <div className="w-80 flex flex-col border-r border-slate-200 pr-4">
        {/* 操作栏 */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder={t('seq.searchPlaceholder')}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <button onClick={handleImport} className="p-1.5 bg-teal-500 text-white rounded hover:bg-teal-600" title={t('seq.importFiles')}>
            <Upload size={14} />
          </button>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto space-y-1">
          {files.map(f => (
            <div
              key={f.id}
              onClick={() => handleSelect(f)}
              className={`p-2 rounded cursor-pointer text-sm transition-colors
                ${selected?.id === f.id ? 'bg-teal-50 border border-teal-200' : 'hover:bg-slate-50 border border-transparent'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 truncate">{f.sample_name || f.file_name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${fileTypeColor(f.file_type)}`}>
                  {fileTypeLabel(f.file_type)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-[10px] flex items-center gap-0.5 ${f.direction === 'forward' ? 'text-blue-600' : 'text-orange-600'}`}>
                  {f.direction === 'forward' ? <ArrowRight size={10} /> : <ArrowLeft size={10} />}
                  {f.direction === 'forward' ? t('seq.forward') : t('seq.reverse')}
                </span>
                {f.primer_name && (
                  <span className="text-[10px] text-emerald-600 truncate">{f.primer_name}</span>
                )}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 truncate">{f.file_name}</div>
            </div>
          ))}
          {files.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-8">{t('seq.noFiles')}</div>
          )}
        </div>
        <div className="text-xs text-slate-400 mt-2">{files.length} {t('seq.files')}</div>
      </div>

      {/* 右侧详情 */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">{selected.sample_name || selected.file_name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs px-2 py-0.5 rounded ${fileTypeColor(selected.file_type)}`}>
                    {fileTypeLabel(selected.file_type)}
                  </span>
                  <span className={`text-xs flex items-center gap-0.5 ${selected.direction === 'forward' ? 'text-blue-600' : 'text-orange-600'}`}>
                    {selected.direction === 'forward' ? <ArrowRight size={12} /> : <ArrowLeft size={12} />}
                    {selected.direction === 'forward' ? t('seq.forward') : t('seq.reverse')}
                  </span>
                  {selected.primer_name && (
                    <span className="text-xs text-emerald-600">{t('seq.primer')}: {selected.primer_name}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleEdit(selected)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded"><Edit2 size={14} /></button>
                <button onClick={() => handleDelete(selected.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
              </div>
            </div>

            {/* 基本信息 */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-slate-50 rounded p-3">
                <div className="text-xs text-slate-500 mb-1">{t('seq.fileName')}</div>
                <div className="text-slate-800">{selected.file_name}</div>
              </div>
              <div className="bg-slate-50 rounded p-3">
                <div className="text-xs text-slate-500 mb-1">{t('seq.sampleName')}</div>
                <div className="text-slate-800">{selected.sample_name || '-'}</div>
              </div>
              <div className="bg-slate-50 rounded p-3">
                <div className="text-xs text-slate-500 mb-1">{t('seq.direction')}</div>
                <div className="flex items-center gap-1">
                  {selected.direction === 'forward' ? <ArrowRight size={14} className="text-blue-500" /> : <ArrowLeft size={14} className="text-orange-500" />}
                  {selected.direction === 'forward' ? t('seq.forward') : t('seq.reverse')}
                </div>
              </div>
              <div className="bg-slate-50 rounded p-3">
                <div className="text-xs text-slate-500 mb-1">{t('seq.primer')}</div>
                <div>{selected.primer_name || '-'}</div>
              </div>
              {selected.sequence && (
                <div className="bg-slate-50 rounded p-3 col-span-2">
                  <div className="text-xs text-slate-500 mb-1">{t('seq.sequence')}</div>
                  <div className="font-mono text-xs text-blue-700 break-all max-h-24 overflow-y-auto">
                    {selected.sequence.substring(0, 200)}{selected.sequence.length > 200 ? '...' : ''}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">{selected.sequence.length} bp</div>
                </div>
              )}
              {/* AB1 色谱峰图 */}
              {selected.file_type === 'ab1' && (
                <div className="col-span-2 bg-white rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-medium text-slate-600">{t('seq.chromatogram')}</div>
                    {traceData && (
                      <button onClick={() => setShowFullScreen(true)} className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100" title={t('seq.fullScreen')}>
                        <Maximize2 size={14} />
                      </button>
                    )}
                  </div>
                  {traceData ? (
                    <ChromatogramViewer
                      traces={traceData.traces || traceData}
                      peakPositions={peakPositions}
                      sequence={selected.sequence || ''}
                      qualityValues={qualityValues}
                      referenceSequence={referenceSequence || undefined}
                      referenceSource={referenceSource || undefined}
                      height={320}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                      <FileText size={24} className="mb-2" />
                      <p className="text-xs">{t('seq.noTraceData')}</p>
                    </div>
                  )}
                </div>
              )}
              {selected.run_info && (
                <div className="bg-slate-50 rounded p-3 col-span-2">
                  <div className="text-xs text-slate-500 mb-1">{t('seq.runInfo')}</div>
                  <div className="text-xs text-slate-700">{selected.run_info}</div>
                </div>
              )}
              {selected.notes && (
                <div className="bg-slate-50 rounded p-3 col-span-2">
                  <div className="text-xs text-slate-500 mb-1">{t('seq.notes')}</div>
                  <div className="text-sm text-slate-700">{selected.notes}</div>
                </div>
              )}
              <div className="bg-slate-50 rounded p-3">
                <div className="text-xs text-slate-500 mb-1">{t('seq.createdAt')}</div>
                <div className="text-xs">{selected.created_at || '-'}</div>
              </div>
              <div className="bg-slate-50 rounded p-3">
                <div className="text-xs text-slate-500 mb-1">{t('seq.updatedAt')}</div>
                <div className="text-xs">{selected.updated_at || '-'}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <FileText size={48} className="mb-3" />
            <p className="text-sm">{t('seq.selectFile')}</p>
          </div>
        )}
      </div>

      {/* 全屏峰图弹窗 */}
      {showFullScreen && traceData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[95vw] h-[90vh] flex flex-col p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-slate-700">
                {t('seq.chromatogram')} — {selected?.sample_name || selected?.file_name}
              </div>
              <button onClick={() => setShowFullScreen(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div ref={fullscreenRef} className="flex-1 min-h-0">
              <ChromatogramViewer
                traces={traceData.traces || traceData}
                peakPositions={peakPositions}
                sequence={selected?.sequence || ''}
                qualityValues={qualityValues}
                referenceSequence={referenceSequence || undefined}
                referenceSource={referenceSource || undefined}
                height={fullscreenH}
              />
            </div>
          </div>
        </div>
      )}

      {/* 编辑弹窗 */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-96 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">{t('seq.editFile')}</h3>
              <button onClick={() => setShowEdit(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div>
              <label className="text-xs text-slate-500">{t('seq.sampleName')}</label>
              <input value={editData.sample_name} onChange={e => setEditData({ ...editData, sample_name: e.target.value })}
                className="w-full mt-1 px-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-teal-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500">{t('seq.direction')}</label>
              <select value={editData.direction} onChange={e => setEditData({ ...editData, direction: e.target.value as SequencingDirection })}
                className="w-full mt-1 px-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-teal-400">
                <option value="forward">{t('seq.forward')}</option>
                <option value="reverse">{t('seq.reverse')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">{t('seq.primer')}</label>
              <select value={editData.primer_id ?? ''} onChange={e => setEditData({ ...editData, primer_id: e.target.value ? Number(e.target.value) : null })}
                className="w-full mt-1 px-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-teal-400">
                <option value="">{t('seq.noPrimer')}</option>
                {primers.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.sequence.substring(0, 15)}...)</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">{t('seq.notes')}</label>
              <textarea value={editData.notes} onChange={e => setEditData({ ...editData, notes: e.target.value })}
                rows={3} className="w-full mt-1 px-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-teal-400" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowEdit(false)} className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded">{t('dialog.cancel')}</button>
              <button onClick={handleEditSubmit} className="px-4 py-1.5 text-sm bg-teal-500 text-white rounded hover:bg-teal-600">{t('dialog.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
