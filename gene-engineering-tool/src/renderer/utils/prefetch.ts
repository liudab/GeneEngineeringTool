/**
 * 数据预加载工具
 * 应用启动时后台预加载高频数据，避免首次访问时的 IPC 延迟
 */

interface PrefetchCache {
  enzymes: any[] | null
  components: any[] | null
  vectors: any[] | null
  enzymesLoadedAt: number
  componentsLoadedAt: number
}

const cache: PrefetchCache = {
  enzymes: null,
  components: null,
  vectors: null,
  enzymesLoadedAt: 0,
  componentsLoadedAt: 0,
}

/** 缓存有效期（5分钟） */
const CACHE_TTL = 5 * 60 * 1000

/**
 * 应用启动时调用：后台预加载酶库和元件库
 * 使用 requestIdleCallback 在浏览器空闲时执行，不影响首屏渲染
 */
export function prefetchAppData(): void {
  const doPrefetch = async () => {
    try {
      // 并行预加载酶库和元件库
      const [enzymes, components] = await Promise.allSettled([
        window.api.getEnzymes(),
        window.api.getComponents?.() || Promise.resolve([]),
      ])
      if (enzymes.status === 'fulfilled' && enzymes.value) {
        cache.enzymes = enzymes.value
        cache.enzymesLoadedAt = Date.now()
      }
      if (components.status === 'fulfilled' && components.value) {
        cache.components = components.value
        cache.componentsLoadedAt = Date.now()
      }
    } catch (e) {
      // 预加载失败不影响正常使用
      console.debug('[Prefetch] Background preload failed:', e)
    }
  }

  // 使用 requestIdleCallback 在空闲时预加载（回退 setTimeout）
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(doPrefetch, { timeout: 3000 })
  } else {
    setTimeout(doPrefetch, 1500)
  }
}

/**
 * 获取预加载的酶库数据（如果缓存有效）
 * 返回 null 表示缓存不可用，调用者应回退到正常 IPC 请求
 */
export function getCachedEnzymes(): any[] | null {
  if (cache.enzymes && Date.now() - cache.enzymesLoadedAt < CACHE_TTL) {
    return cache.enzymes
  }
  return null
}

/**
 * 获取预加载的元件库数据
 */
export function getCachedComponents(): any[] | null {
  if (cache.components && Date.now() - cache.componentsLoadedAt < CACHE_TTL) {
    return cache.components
  }
  return null
}

/**
 * 页面切换时的 prefetch：预加载下一页可能需要的数据
 */
export function prefetchPageData(page: string): void {
  const doPrefetch = async () => {
    try {
      switch (page) {
        case 'genes':
          // 预加载基因列表（轻量）
          break
        case 'vectors':
          // 预加载载体列表
          if (!cache.vectors) {
            cache.vectors = await window.api.getVectors()
          }
          break
      }
    } catch {}
  }

  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(doPrefetch, { timeout: 2000 })
  } else {
    setTimeout(doPrefetch, 500)
  }
}

/** 使缓存失效（数据修改后调用） */
export function invalidateCache(key?: 'enzymes' | 'components' | 'vectors'): void {
  if (!key || key === 'enzymes') { cache.enzymes = null; cache.enzymesLoadedAt = 0 }
  if (!key || key === 'components') { cache.components = null; cache.componentsLoadedAt = 0 }
  if (!key || key === 'vectors') { cache.vectors = null }
}
