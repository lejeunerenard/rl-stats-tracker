import { command, flag, summary } from 'paparam'
import process from 'bare-process'
import os from 'bare-os'
import { isWindows } from 'which-runtime'
import path from 'bare-path'
import pkg from './package.json'
import App from './dist/app.js'
import { ConfigServiceLive } from './dist/services/config.js'
import { CLIService } from './dist/services/cli-ui.js'

const appName = pkg.productName || pkg.name
const isDev = path.basename(Bare.argv[0]) === (isWindows ? 'bare.exe' : 'bare')

const cmd = command(
  appName,
  summary(pkg.description),
  flag('--version|-v', 'Print the current version'),
  flag('--username <name>', 'Rocket League player username to track (overrides config)'),
  flag('--config <path>', 'Path to config file (default: ~/.rl-stats.json)')
)

cmd.parse(Bare.argv.slice(isDev ? 2 : 1))
if (cmd.flags.help) Bare.exit()
if (cmd.flags.version) {
  console.log(`${appName} v${pkg.version}`)
  Bare.exit()
}

const configPath = cmd.flags.config || path.join(os.homedir(), '.rl-stats.json')

const configService = new ConfigServiceLive()
const uiService = new CLIService()

function logStderr(...args) {
  console.error(...args)
}

function jsonOut(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function resolvePlayerName() {
  if (cmd.flags.username) {
    return cmd.flags.username
  }

  const config = configService.load(configPath)
  if (config && config.username) {
    logStderr(`Loaded username from config: ${config.username}`)
    return config.username
  }

  logStderr(`Error: --username is required`)
  logStderr(`Run with --username to set your player name, or create ${configPath}`)
  logStderr(`Example: echo '{"username":"YourName"}' > ${configPath}`)
  Bare.exit(1)
}

const playerName = await resolvePlayerName()

const app = new App({ playerName, configPath })

app.on('message', (message) => {
  if (message.startsWith('status:')) {
    logStderr(message.slice(7))
  } else if (message.startsWith('stats:')) {
    const stats = JSON.parse(message.slice(6))
    logStderr(`Stats: ${stats.wins}W / ${stats.losses}L / ${stats.totalMatches} matches`)
    jsonOut({ type: 'stats', stats })
  } else if (message.startsWith('match:')) {
    const match = JSON.parse(message.slice(6))
    logStderr(`Match: ${match.isWin ? 'Win' : 'Loss'} (team ${match.winnerTeam})`)
    jsonOut({ type: 'match', match })
  } else if (message.startsWith('error:')) {
    logStderr(`[worker:error] ${message.slice(6)}`)
    jsonOut({ type: 'error', error: message.slice(6) })
  } else if (message.startsWith('prompt:choose-player:')) {
    const payload = JSON.parse(message.slice(21))
    handlePlayerPrompt(payload)
  } else {
    logStderr(message)
  }
})

async function handlePlayerPrompt(payload) {
  const { names, currentStored } = payload

  try {
    const selectedName = await uiService.promptPlayer(names, currentStored)
    logStderr(`Selected: ${selectedName}`)

    configService.save(configPath, { username: selectedName })

    app._send(`update-name:${selectedName}`)
  } catch (err) {
    // Prompt was cancelled or failed
  }
}

app.on('error', (err) => logStderr('[app:error]', err))

process.on('SIGHUP', () => app.exit(129))
process.on('SIGINT', () => app.exit(130))
process.on('SIGQUIT', () => app.exit(131))
process.on('SIGTERM', () => app.exit(143))

try {
  await app.ready()
  logStderr(`\nRL Stats Tracker ready. Tracking "${playerName}". Press Ctrl+C to stop.\n`)
} catch (err) {
  logStderr('[app:error]', err)
  await app.close().finally(() => Bare.exit(1))
}
