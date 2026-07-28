import { useState, useEffect, useRef, useCallback, createContext, useContext, type ReactNode } from 'react'

// ============ Types ============
export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  children?: MenuItem[]
  onClick?: (context?: any) => void
}

interface ContextMenuState {
  x: number
  y: number
  items: MenuItem[]
  context?: any // 上下文数据（如选中的元件索引等）
}

interface ContextMenuContextValue {
  showContextMenu: (x: number, y: number, items: MenuItem[], context?: any) => void
  hideContextMenu: () => void
}

// ============ Context ============
const ContextMenuContext = createContext<ContextMenuContextValue | null>(null)

export function useContextMenu(): ContextMenuContextValue {
  const ctx = useContext(ContextMenuContext)
  if (!ctx) throw new Error('useContextMenu must be used within ContextMenuProvider')
  return ctx
}

// ============ Provider ============
export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const showContextMenu = useCallback((x: number, y: number, items: MenuItem[], context?: any) => {
    setMenu({ x, y, items, context })
  }, [])

  const hideContextMenu = useCallback(() => {
    setMenu(null)
  }, [])

  // 点击外部关闭
  useEffect(() => {
    if (!menu) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hideContextMenu()
      }
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideContextMenu()
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [menu, hideContextMenu])

  // 防止菜单溢出视口
  const adjustedPos = menu ? (() => {
    let { x, y } = menu
    const maxW = 220, maxH = 300
    if (x + maxW > window.innerWidth) x = window.innerWidth - maxW - 8
    if (y + maxH > window.innerHeight) y = window.innerHeight - maxH - 8
    return { x: Math.max(8, x), y: Math.max(8, y) }
  })() : null

  return (
    <ContextMenuContext.Provider value={{ showContextMenu, hideContextMenu }}>
      {children}
      {menu && adjustedPos && (
        <div
          ref={menuRef}
          className="fixed z-[99999] bg-white border border-slate-200 rounded-lg shadow-xl py-1 min-w-[180px] max-w-[280px] animate-[toast-in_100ms_ease-out]"
          style={{ left: adjustedPos.x, top: adjustedPos.y }}
          onContextMenu={e => e.preventDefault()}
        >
          {menu.items.map(item => (
            <MenuItemRow key={item.id} item={item} context={menu.context} onAction={hideContextMenu} />
          ))}
        </div>
      )}
    </ContextMenuContext.Provider>
  )
}

// ============ Menu Item Row ============
function MenuItemRow({ item, context, onAction }: { item: MenuItem; context?: any; onAction: () => void }) {
  if (item.separator) {
    return <div className="my-1 border-t border-slate-100" />
  }

  return (
    <button
      onClick={() => {
        if (!item.disabled && !item.children) {
          item.onClick?.(context)
          onAction()
        }
      }}
      disabled={item.disabled}
      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors
        ${item.disabled ? 'text-slate-300 cursor-not-allowed' :
          item.danger ? 'text-red-600 hover:bg-red-50' :
          'text-slate-700 hover:bg-slate-50'
        }`}
    >
      {item.icon && <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">{item.icon}</span>}
      <span className="flex-1 truncate">{item.label}</span>
      {item.shortcut && (
        <span className="text-[10px] text-slate-400 flex-shrink-0">{item.shortcut}</span>
      )}
    </button>
  )
}
