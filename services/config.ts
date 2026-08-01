import fs from 'bare-fs'
import path from 'bare-path'

export interface Config {
  username?: string
}

export interface ConfigService {
  load(filepath: string): Config | null
  save(filepath: string, config: Config): void
}

// TODO Implement with Platform API from Effect once integrating with Bare is figured out
export class ConfigServiceLive implements ConfigService {
  load(filepath: string): Config | null {
    try {
      const data = fs.readFileSync(filepath, 'utf8')
      return JSON.parse(data)
    } catch {
      return null
    }
  }

  save(filepath: string, config: Config): void {
    fs.writeFileSync(filepath, JSON.stringify(config, null, 2), 'utf8')
  }
}
