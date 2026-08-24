import { Layer, Logger, LogLevel } from 'effect'
import fs from 'bare-fs'

export function LoggerLive(
  logPath: string,
  minLevel: LogLevel.Literal = 'Info'
): Layer.Layer<never> {
  if (!logPath) {
    return Logger.replace(Logger.defaultLogger, Logger.none)
  }

  const minLogLevel = LogLevel.fromLiteral(minLevel)

  const fileLogger = Logger.make(({ logLevel, message, date }) => {
    if (LogLevel.lessThan(logLevel, minLogLevel)) {
      return
    }

    const entry =
      JSON.stringify({
        timestamp: date.toISOString(),
        level: logLevel.label,
        message
      }) + '\n'
    fs.appendFileSync(logPath, entry)

    return
  })

  return Logger.replace(Logger.defaultLogger, fileLogger)
}
