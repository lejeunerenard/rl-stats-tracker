import { command, flag, summary } from 'paparam'
import process from 'bare-process'
import os from 'bare-os'
import { isWindows } from 'which-runtime'
import path from 'bare-path'
import pkg from './package.json'
import App from './dist/app.js'

const appName = pkg.productName || pkg.name
const isDev = path.basename(Bare.argv[0]) === (isWindows ? 'bare.exe' : 'bare')

const cmd = command(
  appName,
  summary(pkg.description),
  flag('--version|-v', 'Print the current version'),
  flag('--username <name>', 'Rocket League player username to track')
)

cmd.parse(Bare.argv.slice(isDev ? 2 : 1))
if (cmd.flags.help) Bare.exit()
if (cmd.flags.version) {
  console.log(`${appName} v${pkg.version}`)
  Bare.exit()
}

const playerName = cmd.flags.username
if (!playerName) {
  console.error(`Error: --username is required`)
  console.error(`Usage: ${appName} --username <player name>`)
  Bare.exit(1)
}

const app = new App({ playerName })

function logStderr(...args) {
  console.error(...args)
}

function jsonOut(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

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
  } else {
    logStderr(message)
  }
})

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
