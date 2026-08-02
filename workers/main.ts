import 'bare-encoding/global'

import { Effect, Either, Option, Stream, Layer, Ref, Context } from 'effect'
import { RLStatsService, RLStatsServiceLive, ConfigLive, ConnectionServiceLive } from 'rl-stats-api'
import FramedStream from 'framed-stream'

const framed = new FramedStream(Bare.IPC)
const playerName = (Bare.argv[1] || '').trim()
const configPath = (Bare.argv[2] || '').trim()

// ---------------------------------------------------------------------------
// Event types (re-exported from rl-stats-api which has no .d.ts declarations)
// ---------------------------------------------------------------------------

interface UpdateStateData {
  Players: { Name: string; TeamNum: number }[]
}

interface MatchEndedData {
  WinnerTeamNum: number
}

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
  messages: Stream.fromAsyncIterable<Buffer, string>(framed, () => 'stream-error').pipe(
    Stream.map((buf: Buffer) => buf.toString()),
    Stream.catchAll(() => Stream.fromIterable([]))
  )
})

// ---------------------------------------------------------------------------
// Flexible name matching
// ---------------------------------------------------------------------------

function normalizeName(name) {
  return name.toLowerCase().trim().replace(/\s+/g, ' ')
}

function matchName(stored, candidate) {
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

function findBestMatch(stored, candidates) {
  let best = null as any

  for (const candidate of candidates) {
    if (matchName(stored, candidate)) {
      const a = normalizeName(stored)
      const b = normalizeName(candidate)
      const exactMatch = a === b

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

// ---------------------------------------------------------------------------
// Main program
// ---------------------------------------------------------------------------

const apiHandler = Effect.gen(function* () {
  const rlStats = yield* RLStatsService
  const stats = yield* StatsService
  const ipc = yield* IPCService

  yield* Stream.runForEach(rlStats.parsed, (event) =>
    Effect.gen(function* () {
      if (Either.isLeft(event)) {
        const error = Either.getLeft(event)
        yield* Effect.logError(`Schema error: ${error}`)
        ipc.send(`error:${JSON.stringify(error)}`)
        return
      }

      const o = Either.getRight(event)
      const { Event, Data } = Option.getOrElse(o, () => ({ Event: 'none' as const, Data: null }))

      // Track player team from UpdateState
      if (Event === 'UpdateState') {
        const players = Data.Players

        yield* Ref.update(stats, (state) => {
          state.lastPlayerList = players
          return state
        })

        const current = yield* stats
        const storedName = current.playerName
        const bestMatch = findBestMatch(
          storedName,
          current.lastPlayerList.map((p) => p.Name)
        )

        if (bestMatch) {
          const player = current.lastPlayerList.find((p) => p.Name === bestMatch.name)
          if (player) {
            yield* Ref.update(stats, (state) => {
              state.playerTeam = player.TeamNum
              return state
            })
            yield* Effect.logInfo(
              `Found ${storedName} (matched "${bestMatch.name}") on team ${player.TeamNum}`
            )
            ipc.send(
              `status:Found ${storedName} (matched "${bestMatch.name}") on team ${player.TeamNum}`
            )
          }
        } else {
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
        }
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
        const bestMatch = findBestMatch(
          newName,
          current.lastPlayerList.map((p) => p.Name)
        )
        if (bestMatch) {
          const player = current.lastPlayerList.find((p) => p.Name === bestMatch.name)
          if (player) {
            yield* Ref.update(stats, (state) => {
              state.playerTeam = player.TeamNum
              return state
            })
            yield* Effect.logInfo(
              `Re-matched "${newName}" (found "${bestMatch.name}") on team ${player.TeamNum}`
            )
          }
        }
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
  Effect.provide(Effect.provide(workerProgram, rlStatsLayer), StatsServiceLive),
  IPCServiceLive
)

Effect.runPromise(program).catch((err: unknown) => {
  console.error('Worker error:', err)
  framed.write(`error:${JSON.stringify(err)}`)
})
