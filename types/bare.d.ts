/* eslint-disable */
declare var Bare: {
  argv: string[]
  exit(code?: number): void
  exitCode: number
  IPC: {
    on(event: string, handler: (...args: any[]) => void): any
    write(data: string | Buffer): void
    destroy(): void
    once(event: string, handler: (...args: any[]) => void): any
    pipe(dest: any): any
  }
}

declare var process: {
  on(event: string, handler: (...args: any[]) => void): void
  exit(code?: number): void
  execPath?: string
}

declare var require: {
  (id: string): any
  resolve(id: string): string
}
declare var console: {
  log(...args: any[]): void
  error(...args: any[]): void
  warn(...args: any[]): void
  info(...args: any[]): void
}

declare class Buffer {
  length: number
  toString(): string
  slice(start?: number, end?: number): Buffer
}

declare class EventEmitter {
  on(event: string, handler: (...args: any[]) => void): this
  once(event: string, handler: (...args: any[]) => void): this
  emit(event: string, ...args: any[]): boolean
  off(event: string, handler: (...args: any[]) => void): this
}
