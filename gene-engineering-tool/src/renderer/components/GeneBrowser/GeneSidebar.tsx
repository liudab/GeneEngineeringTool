import { useState, useCallback } from 'react'
import { Search, Plus, Upload, Dna, Database } from 'lucide-react'
import type { GeneSequence } from '../../../shared/types'
import { parseSemicolonTags } from '../ui/TagInput'

interface GeneSidebarProps {
  genes: GeneSequence[]
  selectedGene: GeneSequence | null
  onSelect: (gene: GeneSequence) => void
  onSearch: (query: string) => void
  onCreate: () => void
  onImport: () => void
  onImportPackage?: () => void
  onOpenNCBI: () => void
  onOpenRiceImport: () => void
  importMsg: string
}

export default function GeneSidebar({
  genes, selectedGene, onSelect, onSearch, onCreate, onImport, onImportPackage, onOpenNCBI, onOpenRiceImport, importMsg
}: GeneSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const handleSearch = useCallback(() => {
    onSearch(searchQuery)
  }, [searchQuery, onSearch])

  return (
    <div className="w-80 flex-shrink-0 flex flex-col border-r border-slate-200 bg-white overflow-hidden">
      {/* 搜索栏 */}
      <div className="p-3 border-b border-slate-100 space-y-2">
        <div className="flex gap-1.5">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="搜索基因符号或名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-8 pr-2 py-1.5 border border-slate-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            />
          </div>
          <button onClick={handleSearch} className="px-2.5 py-1.5 bg-cyan-600 text-white rounded-md text-xs hover:bg-cyan-500 transition-colors">
            搜索
          </button>
        </div>
        <div className="flex gap-1.5">
          <button onClick={onOpenNCBI} className="flex-1 px-2 py-1.5 bg-indigo-600 text-white rounded-md text-xs hover:bg-indigo-500 flex items-center justify-center gap-1 transition-colors" title="从NCBI导入基因">
            <Dna size={12} /> NCBI 导入
          </button>
          <button onClick={onOpenRiceImport} className="flex-1 px-2 py-1.5 bg-emerald-600 text-white rounded-md text-xs hover:bg-emerald-500 flex items-center justify-center gap-1 transition-colors" title="从水稻插件数据库导入基因">
            <Database size={12} /> 水稻导入
          </button>
          <button onClick={onCreate} className="px-2 py-1.5 bg-green-600 text-white rounded-md text-xs hover:bg-green-500 flex items-center gap-1 transition-colors">
            <Plus size={12} /> 添加
          </button>
                    <button onClick={onImport} className="px-2 py-1.5 bg-orange-500 text-white rounded-md text-xs hover:bg-orange-400 flex items-center gap-1 transition-colors" title="导入文件">
            <Upload size={12} /> 文件
          </button>
          {onImportPackage && (
            <button onClick={onImportPackage} className="px-2 py-1.5 bg-teal-600 text-white rounded-md text-xs hover:bg-teal-500 flex items-center gap-1 transition-colors" title="导入基因数据包（ZIP）">
              <Upload size={12} /> 数据包
            </button>
          )}
        </div>
        {importMsg && <div className="text-xs text-green-600 bg-green-50 rounded px-2 py-1">{importMsg}</div>}
      </div>

      {/* 基因列表 */}
      <div className="flex-1 overflow-auto">
        {genes.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs">暂无数据</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {genes.map(gene => {
              const nameTags = parseSemicolonTags(gene.gene_name)
              const dbTags = parseSemicolonTags(gene.gene_symbol)
              const primaryName = nameTags[0] || gene.gene_name || '未命名'
              const extraNameCount = nameTags.length > 1 ? nameTags.length - 1 : 0
              return (
              <div
                key={gene.id}
                onClick={() => onSelect(gene)}
                className={`px-3 py-2 cursor-pointer transition-colors ${
                  selectedGene?.id === gene.id ? 'bg-cyan-50 border-l-2 border-cyan-500' : 'hover:bg-slate-50 border-l-2 border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 truncate flex-1">
                    {primaryName}
                    {extraNameCount > 0 && (
                      <span className="ml-1 px-1 py-0.5 bg-slate-200 text-slate-500 rounded text-[9px] font-medium">+{extraNameCount}</span>
                    )}
                  </span>
                </div>
                {/* 数据库存取号标签组 */}
                {dbTags.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {dbTags.slice(0, 3).map((tag, i) => (
                      <span key={i} className="px-1 py-0 rounded text-[9px] bg-indigo-50 text-indigo-600 border border-indigo-100 truncate max-w-[120px]" title={tag}>
                        {tag}
                      </span>
                    ))}
                    {dbTags.length > 3 && (
                      <span className="px-1 py-0 rounded text-[9px] bg-slate-100 text-slate-500">+{dbTags.length - 3}</span>
                    )}
                  </div>
                )}
                <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                  {gene.species && <span className="italic mr-1">{gene.species}</span>}
                  {gene.sequence && (
                    <span className="text-slate-400">
                      {gene.sequence.length.toLocaleString()} {gene.type === 'protein' ? 'aa' : 'bp'}
                    </span>
                  )}
                </div>
                {gene.chromosome && (
                  <div className="text-[10px] text-slate-400">Chr: {gene.chromosome}</div>
                )}
              </div>
              )
            })}
          </div>
        )}
        <div className="text-[10px] text-slate-400 px-3 py-2">共 {genes.length} 条记录</div>
      </div>
    </div>
  )
}
