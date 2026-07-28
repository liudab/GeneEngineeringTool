declare module 'sql.js' {
  export interface Database {
    run(sql: string, params?: any[]): Database
    exec(sql: string, params?: any[]): QueryExecResult[]
    prepare(sql: string, params?: any[]): Statement
    close(): void
    export(): Uint8Array
    getRowsModified(): number
  }
  export interface Statement {
    bind(params?: any[]): boolean
    step(): boolean
    getAsObject(params?: any[]): Record<string, any>
    get(params?: any[]): any[]
    free(): boolean
    reset(): void
    run(params?: any[]): void
  }
  export interface QueryExecResult {
    columns: string[]
    values: any[][]
  }
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database
  }
  export default function initSqlJs(config?: any): Promise<SqlJsStatic>
}
