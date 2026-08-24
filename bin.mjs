import 'bare-encoding/global'
import { command, flag, summary } from 'paparam'
import process from 'bare-process'
import os from 'bare-os'
import { isWindows } from 'which-runtime'
import path from 'bare-path'
import fs from 'bare-fs'
import pkg from './package.json'
import App from './dist/app.js'
import { Effect } from 'effect'
import { ConfigServiceLive } from './dist/services/config.js'
import { CLIServiceLive } from './dist/services/cli-ui.js'
import { UIService } from './dist/services/ui.js'

const appName = pkg.productName || pkg.name
const isDev = path.basename(Bare.argv[0]) === (isWindows ? 'bare.exe' : 'bare')

function createFileLogger(logPath) {
  function log(message, level = 'info') {
    const entry =
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        message
      }) + '\n'
    fs.appendFileSync(logPath, entry)
  }
  return log
}

const cmd = command(
  appName,
  summary(pkg.description),
  flag('--version|-v', 'Print the current version'),
  flag('--username <name>', 'Rocket League player username to track (overrides config)'),
  flag('--config <path>', 'Path to config file (default: ~/.rl-stats.json)'),
  flag('--log <path>', 'Path to log file (default: ~/.rl-stats.log)'),
  flag('--log-level <level>', 'Minimum log level for file logging (default: Info)'),
  flag('--json', 'Enable JSON structured output to stdout')
)

cmd.parse(Bare.argv.slice(isDev ? 2 : 1))
if (cmd.flags.help) Bare.exit()
if (cmd.flags.version) {
  console.log(`${appName} v${pkg.version}`)
  Bare.exit()
}

const configPath = cmd.flags.config || path.join(os.homedir(), '.rl-stats.json')
const logPath = cmd.flags.log || path.join(os.homedir(), '.rl-stats.log')
const logLevelRaw = cmd.flags.logLevel || 'Info'

const configService = new ConfigServiceLive()
const uiService = Effect.runSync(
  Effect.gen(function* () {
    return yield* UIService
  }).pipe(Effect.provide(CLIServiceLive))
)

function jsonOut(obj) {
  if (!cmd.flags.json) return
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function resolvePlayerName(fileLogger) {
  if (cmd.flags.username) {
    return cmd.flags.username
  }

  const config = configService.load(configPath)
  if (config && config.username) {
    fileLogger(`Loaded username from config: ${config.username}`)
    return config.username
  }

  console.log(`Error: --username is required`)
  console.log(`Run with --username to set your player name, or create ${configPath}`)
  console.log(`Example: echo '{"username":"YourName"}' > ${configPath}`)
  Bare.exit(1)
}

const fileLogger = createFileLogger(logPath)
const playerName = await resolvePlayerName(fileLogger)

const app = new App({ playerName, configPath, logPath, logLevel: logLevelRaw })

app.on('message', (message) => {
  if (message.startsWith('status:')) {
    fileLogger(message.slice(7))
  } else if (message.startsWith('stats:')) {
    const stats = JSON.parse(message.slice(6))
    console.log(`Stats: ${stats.wins}W / ${stats.losses}L / ${stats.totalMatches} matches`)
    jsonOut({ type: 'stats', stats })
  } else if (message.startsWith('match:')) {
    const match = JSON.parse(message.slice(6))
    console.log(`Match: ${match.isWin ? 'Win' : 'Loss'} (team ${match.winnerTeam})`)
    jsonOut({ type: 'match', match })
  } else if (message.startsWith('error:')) {
    console.log(`[worker:error] ${message.slice(6)}`)
    jsonOut({ type: 'error', error: message.slice(6) })
  } else if (message.startsWith('prompt:choose-player:')) {
    const payload = JSON.parse(message.slice(21))
    handlePlayerPrompt(payload, fileLogger)
  } else {
    fileLogger(message)
  }
})

async function handlePlayerPrompt(payload, fileLogger) {
  const { names, currentStored } = payload

  try {
    const selectedName = await uiService.promptPlayer(names, currentStored)
    fileLogger(`Selected: ${selectedName}`)

    configService.save(configPath, { username: selectedName })

    app._send(`update-name:${selectedName}`)
  } catch (err) {
    // Prompt was cancelled or failed
  }
}

app.on('error', (err) => console.log('[app:error]', err))

process.on('SIGHUP', () => app.exit(129))
process.on('SIGINT', () => app.exit(130))
process.on('SIGQUIT', () => app.exit(131))
process.on('SIGTERM', () => app.exit(143))

try {
  await app.ready()
  fileLogger(`RL Stats Tracker ready. Tracking "${playerName}". Press Ctrl+C to stop.`)
} catch (err) {
  console.log('[app:error]', err)
  await app.close().finally(() => Bare.exit(1))
}
