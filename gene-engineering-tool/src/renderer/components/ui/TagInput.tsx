import { useState, useRef, useCallback, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'

interface TagInputProps {
  /** 当前标签列表 */
  tags: string[]
  /** 标签变化回调 */
  onChange: (tags: string[]) => void
  /** 标签分隔符（默认分号 ; 和 ；） */
  separators?: string[]
  /** 占位文本 */
  placeholder?: string
  /** 是否只读 */
  readOnly?: boolean
  /** 标签颜色样式（可选，传入函数根据标签值返回颜色类名） */
  tagColorFn?: (tag: string) => string
  /** 标签格式校验（返回 false 则不添加） */
  validate?: (tag: string) => boolean
  /** 输入提示（如 "输入数据库:存取号"） */
  inputHint?: string
}

/** 通用多标签输入组件 */
export default function TagInput({
  tags,
  onChange,
  separators = [';', '；'],
  placeholder = '输入后按 Enter 添加...',
  readOnly = false,
  tagColorFn,
  validate,
  inputHint
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addTag = useCallback((raw: string) => {
    const val = raw.trim()
    if (!val) return
    if (validate && !validate(val)) return
    if (tags.includes(val)) return
    onChange([...tags, val])
  }, [tags, onChange, validate])

  const removeTag = useCallback((index: number) => {
    onChange(tags.filter((_, i) => i !== index))
  }, [tags, onChange])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab' || separators.includes(e.key)) {
      e.preventDefault()
      addTag(inputValue)
      setInputValue('')
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1)
    }
  }

  const handleChange = (val: string) => {
    // 检查是否包含分隔符
    for (const sep of separators) {
      if (val.includes(sep)) {
        const parts = val.split(sep)
        // 添加除最后一个以外的所有部分
        for (let i = 0; i < parts.length - 1; i++) {
          addTag(parts[i])
        }
        setInputValue(parts[parts.length - 1])
        return
      }
    }
    setInputValue(val)
  }

  const defaultTagColor = 'bg-slate-100 text-slate-700 border-slate-200'

  return (
    <div
      className="w-full border rounded-lg px-2 py-1.5 flex flex-wrap gap-1 min-h-[36px] cursor-text focus-within:ring-2 focus-within:ring-cyan-500 focus-within:border-transparent bg-white"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs border ${tagColorFn?.(tag) || defaultTagColor}`}
        >
          <span className="max-w-[140px] truncate" title={tag}>{tag}</span>
          {!readOnly && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(i) }}
              className="text-slate-400 hover:text-red-500 flex-shrink-0"
            >
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (inputValue.trim()) { addTag(inputValue); setInputValue('') } }}
          placeholder={tags.length === 0 ? placeholder : inputHint || ''}
          className="flex-1 min-w-[80px] text-xs outline-none bg-transparent py-0.5"
        />
      )}
    </div>
  )
}

// ============ 工具函数 ============

/** 解析分号分隔的字符串为标签数组 */
export function parseSemicolonTags(value: string | undefined | null): string[] {
  if (!value) return []
  return value.split(/[;；]/).map(s => s.trim()).filter(Boolean)
}

/** 将标签数组序列化为分号分隔的字符串 */
export function serializeSemicolonTags(tags: string[]): string {
  return tags.filter(Boolean).join(';')
}

/** 数据库存取号标签的常用颜色映射（key 统一大写） */
const DB_COLORS: Record<string, string> = {
  'NCBI': 'bg-blue-100 text-blue-700 border-blue-200',
  'ENSEMBL': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'RAP-DB': 'bg-amber-100 text-amber-700 border-amber-200',
  'UNIPROT': 'bg-purple-100 text-purple-700 border-purple-200',
  'MSU': 'bg-teal-100 text-teal-700 border-teal-200',
  'GRAMENE': 'bg-rose-100 text-rose-700 border-rose-200',
  'KEGG': 'bg-orange-100 text-orange-700 border-orange-200',
  'TAIR': 'bg-lime-100 text-lime-700 border-lime-200',
  'FLYBASE': 'bg-cyan-100 text-cyan-700 border-cyan-200',
  'WORMBASE': 'bg-pink-100 text-pink-700 border-pink-200',
}

/** 根据数据库前缀获取标签颜色（大小写不敏感） */
export function getDbAccessionColor(tag: string): string {
  const dbName = (tag.split(':')[0] || '').toUpperCase()
  return DB_COLORS[dbName] || 'bg-slate-100 text-slate-700 border-slate-200'
}

/** 校验数据库存取号格式（必须包含 : 分隔符） */
export function validateDbAccession(tag: string): boolean {
  return tag.includes(':') && tag.split(':').every(s => s.trim().length > 0)
}

/** 常见数据库名称列表（用于自动补全提示） */
export const COMMON_DB_PREFIXES = [
  'NCBI', 'Ensembl', 'RAP-DB', 'UniProt', 'MSU', 'Gramene', 'KEGG', 'TAIR', 'FlyBase', 'WormBase'
]
