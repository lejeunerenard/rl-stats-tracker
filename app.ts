import FramedStream from 'framed-stream'
import PearRuntime from 'pear-runtime'
import ReadyResource = require('ready-resource')

interface AppOptions {
  playerName: string
}

interface AppEvents {
  message: [message: string]
  updating: []
  updated: []
  'update-applied': []
  error: [err: Error]
}

export default class App extends ReadyResource {
  playerName: string

  private IPC: any
  private pipe: FramedStream

  constructor(opts: AppOptions) {
    super()

    this.playerName = opts.playerName

    this.IPC = null
    this.pipe = null as any
  }

  async _open() {
    this.IPC = PearRuntime.run(require.resolve('./workers/main.js'), [this.playerName])
    this.pipe = new FramedStream(this.IPC)

    this.pipe.on('data', (data: Buffer) => this._onmessage(data))
    this.pipe.on('error', (err: Error) => this.emit('error', err))
    this.IPC.on('error', (err: Error) => this.emit('error', err))
    this.IPC.on('exit', (code: number) => {
      if (code === 0 || this.closing !== null || this.closed) return
      this.emit('error', new Error(`Updates worker exited with code ${code}`))
    })
    await Promise.resolve()
  }

  async _close() {
    const pipe = this.pipe
    const IPC = this.IPC

    this.pipe = null
    this.IPC = null

    pipe?.destroy()
    IPC?.destroy()
    await Promise.resolve()
  }

  _onmessage(data: Buffer) {
    const message = data.toString()

    if (message === 'updating') {
      this.emit('updating')
      return
    }

    if (message === 'updated') {
      this.emit('updated')
      this._send('pear:applyUpdate')
      return
    }

    if (message === 'pear:updateApplied') {
      this.emit('update-applied')
      return
    }

    this.emit('message', message)
  }

  _send(message: string) {
    if (this.pipe === null) return
    this.pipe.write(message)
  }

  async exit(code = 0) {
    Bare.exitCode = code
    await this.close()
  }

  emit(event: string, ...args: any[]): boolean {
    return false
  }
}
