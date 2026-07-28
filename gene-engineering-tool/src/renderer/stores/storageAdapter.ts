/**
 * 存储适配器抽象层
 * - Electron 环境：通过 IPC 调用主进程 SQLite
 * - PWA/Web 环境：通过 IndexedDB 本地存储
 * 自动检测运行环境，选择最佳存储方案
 */

// ============ 环境检测 ============
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).api
}

// ============ IndexedDB 封装 ============
const DB_NAME = 'genetool_pwa'
const DB_VERSION = 1

interface DBSchema {
  vectors: { key: number; value: any }
  genes: { key: number; value: any }
  enzymes: { key: number; value: any }
  primers: { key: number; value: any }
  lab_vectors: { key: number; value: any }
  settings: { key: string; value: any }
  sequences: { key: string; value: any }
}

const STORE_NAMES = Object.keys({
  vectors: 1, genes: 1, enzymes: 1, primers: 1,
  lab_vectors: 1, settings: 1, sequences: 1
}) as (keyof DBSchema)[]

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      STORE_NAMES.forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          const keyPath = name === 'settings' || name === 'sequences' ? 'key' : 'id'
          db.createObjectStore(name, { keyPath, autoIncrement: keyPath === 'id' })
        }
      })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// 单例缓存
let dbPromise: Promise<IDBDatabase> | null = null
function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDB()
  return dbPromise
}

async function idbGetAll(storeName: keyof DBSchema): Promise<any[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(storeName: keyof DBSchema, key: any): Promise<any> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(storeName: keyof DBSchema, value: any): Promise<any> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req = store.put(value)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbDelete(storeName: keyof DBSchema, key: any): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req = store.delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function idbCount(storeName: keyof DBSchema): Promise<number> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req = store.count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ============ 统一存储适配器接口 ============
export interface StorageAdapter {
  // 载体
  getVectors(): Promise<any[]>
  getVector(id: number): Promise<any>
  createVector(data: any): Promise<number>
  updateVector(id: number, data: any): Promise<void>
  deleteVector(id: number): Promise<void>

  // 基因
  getGenes(): Promise<any[]>
  getGene(id: number): Promise<any>
  createGene(data: any): Promise<number>
  updateGene(id: number, data: any): Promise<void>
  deleteGene(id: number): Promise<void>

  // 引物
  getPrimers(category?: string): Promise<any[]>
  getPrimer(id: number): Promise<any>
  createPrimer(data: any): Promise<number>
  updatePrimer(id: number, data: any): Promise<void>
  deletePrimer(id: number): Promise<void>

  // 酶
  getEnzymes(): Promise<any[]>

  // 设置
  getSetting(key: string): Promise<any>
  setSetting(key: string, value: any): Promise<void>

  // 元信息
  getStorageType(): 'electron-ipc' | 'indexeddb'
  isReady(): boolean
}

// ============ Electron IPC 适配器 ============
class ElectronStorageAdapter implements StorageAdapter {
  getStorageType() { return 'electron-ipc' as const }
  isReady() { return !!(window as any).api }

  async getVectors() { return (window as any).api.getVectors() }
  async getVector(id: number) { return (window as any).api.getVector(id) }
  async createVector(data: any) { return (window as any).api.createVector(data) }
  async updateVector(id: number, data: any) { return (window as any).api.updateVector(id, data) }
  async deleteVector(id: number) { return (window as any).api.deleteVector(id) }

  async getGenes() { return (window as any).api.getGenes() }
  async getGene(id: number) { return (window as any).api.getGene(id) }
  async createGene(data: any) { return (window as any).api.createGene(data) }
  async updateGene(id: number, data: any) { return (window as any).api.updateGene(id, data) }
  async deleteGene(id: number) { return (window as any).api.deleteGene(id) }

  async getPrimers(category?: string) { return (window as any).api.getPrimers(category) }
  async getPrimer(id: number) { return (window as any).api.getPrimer(id) }
  async createPrimer(data: any) { return (window as any).api.createPrimer(data) }
  async updatePrimer(id: number, data: any) { return (window as any).api.updatePrimer(id, data) }
  async deletePrimer(id: number) { return (window as any).api.deletePrimer(id) }

  async getEnzymes() { return (window as any).api.getEnzymes() }

  async getSetting(key: string) { return (window as any).api.getSetting?.(key) }
  async setSetting(key: string, value: any) { return (window as any).api.setSetting?.(key, value) }
}

// ============ IndexedDB 适配器（PWA 模式） ============
class IndexedDBStorageAdapter implements StorageAdapter {
  getStorageType() { return 'indexeddb' as const }
  isReady() { return true }

  async getVectors() { return idbGetAll('vectors') }
  async getVector(id: number) { return idbGet('vectors', id) }
  async createVector(data: any) { return idbPut('vectors', data) }
  async updateVector(id: number, data: any) { return idbPut('vectors', { ...data, id }) }
  async deleteVector(id: number) { return idbDelete('vectors', id) }

  async getGenes() { return idbGetAll('genes') }
  async getGene(id: number) { return idbGet('genes', id) }
  async createGene(data: any) { return idbPut('genes', data) }
  async updateGene(id: number, data: any) { return idbPut('genes', { ...data, id }) }
  async deleteGene(id: number) { return idbDelete('genes', id) }

  async getPrimers(category?: string) {
    const all = await idbGetAll('primers')
    return category ? all.filter((p: any) => p.category === category) : all
  }
  async getPrimer(id: number) { return idbGet('primers', id) }
  async createPrimer(data: any) { return idbPut('primers', data) }
  async updatePrimer(id: number, data: any) { return idbPut('primers', { ...data, id }) }
  async deletePrimer(id: number) { return idbDelete('primers', id) }

  async getEnzymes() { return idbGetAll('enzymes') }

  async getSetting(key: string) { return idbGet('settings', key) }
  async setSetting(key: string, value: any) { return idbPut('settings', { key, value }) }
}

// ============ 工厂函数 ============
let adapter: StorageAdapter | null = null

export function getStorageAdapter(): StorageAdapter {
  if (!adapter) {
    adapter = isElectron()
      ? new ElectronStorageAdapter()
      : new IndexedDBStorageAdapter()
    console.log(`[Storage] Initialized: ${adapter.getStorageType()}`)
  }
  return adapter
}

/**
 * 获取当前运行环境信息
 */
export function getRuntimeInfo() {
  return {
    isElectron: isElectron(),
    isPWA: !isElectron() && window.matchMedia('(display-mode: standalone)').matches,
    isWeb: !isElectron(),
    storageType: isElectron() ? 'electron-ipc' : 'indexeddb',
    userAgent: navigator.userAgent,
    platform: navigator.platform
  }
}
