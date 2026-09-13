import 'bare-encoding/global'

import {
  Effect,
  Either,
  Option,
  Queue,
  Stream,
  Schedule,
  Layer,
  Ref,
  Context,
  LogLevel
} from 'effect'
import { RLStatsService, RLStatsServiceLive, ConfigLive, ConnectionServiceLive } from 'rl-stats-api'
import FramedStream from 'framed-stream'
import { LoggerLive } from '../services/logger.js'

const framed = new FramedStream(Bare.IPC)
const playerName = (Bare.argv[2] || '').trim()
const workerLogPath = Bare.argv[4] || ''
// TODO verify the arg is the info via schema potentially. Probably all args need validation
const workerLogLevel: LogLevel.Literal = (Bare.argv[5] || 'Info') as LogLevel.Literal

// ---------------------------------------------------------------------------
// Stats state (shared between Effect context and IPC handler)
// ---------------------------------------------------------------------------

interface PlayerInfo {
  Name: string
  TeamNum: number
}

interface StatsState {
  playerName: string
  playerTeam: number | null
  wins: number
  losses: number
  totalMatches: number
  lastPlayerList: readonly PlayerInfo[]
}

const statsState: StatsState = {
  playerName: playerName,
  playerTeam: null,
  wins: 0,
  losses: 0,
  totalMatches: 0,
  lastPlayerList: []
}

// ---------------------------------------------------------------------------
// Custom services
// ---------------------------------------------------------------------------

class StatsService extends Context.Tag('@rlstats-tracker/Stats')<
  StatsService,
  Ref.Ref<StatsState>
>() {}

const statsRef = Ref.make(statsState)
const StatsServiceLive = Layer.effect(StatsService, statsRef)

class IPCService extends Context.Tag('@rlstats-tracker/IPC')<
  IPCService,
  { send: (msg: string) => void; messages: Stream.Stream<string> }
>() {}

const IPCServiceLive = Layer.succeed(IPCService, {
  send: (msg: string) => framed.write(msg),
  messages: Stream.fromEventListener<string>(framed, 'data').pipe(
    Stream.map((buf: Buffer) => buf.toString()),
    Stream.catchAll(() => Stream.fromIterable([]))
  )
})

// ---------------------------------------------------------------------------
// Flexible name matching
// ---------------------------------------------------------------------------

function normalizeName(name: string) {
  return name.toLowerCase().trim().replace(/\s+/g, ' ')
}

function matchName(stored: string, candidate: string) {
  const a = normalizeName(stored)
  const b = normalizeName(candidate)

  if (a === b) return true

  const aNormalized = a.normalize('NFC')
  const bNormalized = b.normalize('NFC')

  if (aNormalized === bNormalized) return true

  const aDecomposed = a.normalize('NFD')
  const bDecomposed = b.normalize('NFD')

  if (aDecomposed === bDecomposed) return true

  if (aNormalized.includes(bNormalized) || bNormalized.includes(aNormalized)) return true

  if (aDecomposed.includes(bDecomposed) || bDecomposed.includes(aDecomposed)) return true

  return false
}

function findBestMatch(stored: string, candidates: string[]) {
  let best = null as any

  for (const candidate of candidates) {
    if (matchName(stored, candidate)) {
      const a = normalizeName(stored)
      const b = normalizeName(candidate)

      let score = -1
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === b[i]) {
          score = i
          continue
        }

        break
      }

      if (!best || score > best.score) {
        best = { name: candidate, score }
      }
    }
  }

  return best
}

function findMatchedPlayer(
  storedName: string,
  playerList: readonly PlayerInfo[]
): Option.Option<PlayerInfo> {
  return Option.flatMap(
    Option.fromNullable(
      findBestMatch(
        storedName,
        playerList.map((p) => p.Name)
      )
    ),
    (match) => Option.fromNullable(playerList.find((p) => p.Name === match.name))
  )
}

// ---------------------------------------------------------------------------
// Main program
// ---------------------------------------------------------------------------

const apiHandler = Effect.gen(function* () {
  const rlStats = yield* RLStatsService
  const stats = yield* StatsService
  const ipc = yield* IPCService

  // Unused atm but will be used for sending commands to RL
  const requests = yield* Queue.unbounded<string>()

  yield* Stream.fromQueue(requests).pipe(
    Stream.pipeThroughChannel(rlStats.parsed),
    Stream.runForEach((event) =>
      Either.match(event, {
        onLeft: Effect.fnUntraced(function* (error) {
          yield* Effect.logError(`Schema error: ${error}`)
          ipc.send(`error:${JSON.stringify(error)}`)
        }),
        onRight: Effect.fnUntraced(function* ({ Event, Data }) {
          // Track player team from UpdateState
          if (Event === 'UpdateState') {
            const players = Data.Players

            yield* Ref.update(stats, (state) => {
              state.lastPlayerList = players
              return state
            })

            const current = yield* stats
            const storedName = current.playerName
            const player = findMatchedPlayer(storedName, current.lastPlayerList)

            yield* Option.match(player, {
              onNone: () =>
                Effect.gen(function* () {
                  yield* Effect.logWarning(
                    `No match found for "${storedName}" in current player list: ${current.lastPlayerList.map((p) => p.Name).join(', ')}`
                  )
                  yield* Ref.update(stats, (state) => {
                    state.playerTeam = null
                    return state
                  })
                  ipc.send(
                    `status:No match found for "${storedName}". Waiting for next match to prompt selection.`
                  )
                }),
              onSome: (matched) =>
                Effect.gen(function* () {
                  yield* Ref.update(stats, (state) => {
                    state.playerTeam = matched.TeamNum
                    return state
                  })
                  yield* Effect.logInfo(
                    `Found ${storedName} (matched "${matched.Name}") on team ${matched.TeamNum}`
                  )
                  ipc.send(
                    `status:Found ${storedName} (matched "${matched.Name}") on team ${matched.TeamNum}`
                  )
                })
            })
          }

          // Track wins/losses on MatchEnded
          if (Event === 'MatchEnded') {
            const winnerTeam = Data.WinnerTeamNum
            const current = yield* stats
            const isWin = current.playerTeam === winnerTeam

            yield* Ref.update(stats, (state) => {
              state.wins += isWin ? 1 : 0
              state.losses += isWin ? 0 : 1
              state.totalMatches += 1
              return state
            })

            const updated = yield* stats
            yield* Effect.logInfo(
              `Match ended! ${isWin ? 'Win' : 'Loss'} — ${updated.wins}W/${updated.losses}L/${updated.totalMatches} total`
            )
            ipc.send(`stats:${JSON.stringify(updated)}`)
            ipc.send(`match:${JSON.stringify({ winnerTeam, isWin })}`)

            // If we still don't have a player team, prompt user to select
            if (updated.playerTeam === null && updated.lastPlayerList.length > 0) {
              const names = updated.lastPlayerList.map((p) => p.Name)
              ipc.send(
                `prompt:choose-player:${JSON.stringify({ names, currentStored: updated.playerName })}`
              )
            }
          }
        })
      })
    )
  )
})

const ipcHandler = Effect.gen(function* () {
  const stats = yield* StatsService
  const ipc = yield* IPCService

  yield* Stream.runForEach(ipc.messages, (message) =>
    Effect.gen(function* () {
      if (message.startsWith('update-name:')) {
        const newName = message.slice(12).trim()
        yield* Effect.logInfo(`Received name update: ${newName}`)

        yield* Ref.update(stats, (state) => {
          state.playerName = newName
          state.playerTeam = null
          return state
        })

        const current = yield* stats
        const player = findMatchedPlayer(newName, current.lastPlayerList)
        yield* Option.map(player, (matched) =>
          Effect.gen(function* () {
            yield* Ref.update(stats, (state) => {
              state.playerTeam = matched.TeamNum
              return state
            })
            yield* Effect.logInfo(
              `Re-matched "${newName}" (found "${matched.Name}") on team ${matched.TeamNum}`
            )
          })
        )
      }
    })
  )
})

const workerProgram = Effect.gen(function* () {
  yield* Effect.forkDaemon(apiHandler)
  yield* Effect.forkDaemon(ipcHandler)
})

// ---------------------------------------------------------------------------
// Compose & run
// ---------------------------------------------------------------------------

const rlStatsLayer = RLStatsServiceLive.pipe(
  Layer.provide(ConnectionServiceLive),
  Layer.provide(ConfigLive)
)

const program = Effect.provide(
  Effect.provide(
    Effect.provide(Effect.provide(workerProgram, rlStatsLayer), StatsServiceLive),
    IPCServiceLive
  ),
  LoggerLive(workerLogPath, workerLogLevel)
)

Effect.runPromise(program).catch((err: unknown) => {
  console.error('Worker error:', err)
  framed.write(`error:${JSON.stringify(err)}`)
})
