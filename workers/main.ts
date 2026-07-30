require('bare-encoding/global')

const { Effect, Stream, Layer, Schedule, Ref, Context } = require('effect')
const { RLStatsService, RLStatsServiceLive, ConfigLive } = require('rl-stats-api')
const { ConnectionServiceLive } = require('rl-stats-api/layers/connection')
const FramedStream = require('framed-stream')

const framed = new FramedStream(Bare.IPC)
const playerName = (Bare.argv[1] || '').trim()

// ---------------------------------------------------------------------------
// Stats state
// ---------------------------------------------------------------------------

interface StatsState {
  playerTeam: number | null
  wins: number
  losses: number
  totalMatches: number
}

const initialStats: StatsState = {
  playerTeam: null,
  wins: 0,
  losses: 0,
  totalMatches: 0
}

// ---------------------------------------------------------------------------
// Custom services
// ---------------------------------------------------------------------------

// @ts-ignore
class StatsService extends (Context.Tag as any)('@rlstats-tracker/Stats')<StatsService, any>() {}

const StatsServiceLive = Layer.effect(StatsService, Ref.make(initialStats))

// @ts-ignore
class IPCService extends (Context.Tag as any)('@rlstats-tracker/IPC')<
  IPCService,
  { send: (msg: string) => void }
>() {}

const IPCServiceLive = Layer.succeed(IPCService, {
  send: (msg: string) => framed.write(msg)
})

// ---------------------------------------------------------------------------
// Main program
// ---------------------------------------------------------------------------

const workerProgram = Effect.gen(function* () {
  const rlStats = yield* RLStatsService
  // @ts-ignore
  const statsRef = yield* StatsService
  // @ts-ignore
  const ipc = yield* IPCService

  yield* Stream.runForEach(rlStats.parsed, (event) =>
    Effect.gen(function* () {
      if (event.type === 'error') {
        yield* Effect.logError(`Schema error: ${event.error}`)
        ipc.send(`error:${JSON.stringify(event.error)}`)
        return
      }

      const { event: eventName, data } = event

      // Track player team from UpdateState
      if (eventName === 'UpdateState') {
        const players = (data as any).Players
        const player = players.find((p: any) => p.Name === playerName)
        if (player) {
          yield* Ref.update(statsRef, (s) => ({ ...s, playerTeam: player.TeamNum }))
          yield* Effect.logInfo(`Found ${playerName} on team ${player.TeamNum}`)
          ipc.send(`status:Found ${playerName} on team ${player.TeamNum}`)
        }
      }

      // Track wins/losses on MatchEnded
      if (eventName === 'MatchEnded') {
        const winnerTeam = (data as any).WinnerTeamNum
        const currentStats = yield* Ref.get(statsRef)
        const isWin = currentStats.playerTeam === winnerTeam

        yield* Ref.update(statsRef, (s) => ({
          ...s,
          wins: s.wins + (isWin ? 1 : 0),
          losses: s.losses + (isWin ? 0 : 1),
          totalMatches: s.totalMatches + 1
        }))

        const stats = yield* Ref.get(statsRef)
        yield* Effect.logInfo(
          `Match ended! ${isWin ? 'Win' : 'Loss'} — ${stats.wins}W/${stats.losses}L/${stats.totalMatches} total`
        )
        ipc.send(`stats:${JSON.stringify(stats)}`)
        ipc.send(`match:${JSON.stringify({ winnerTeam, isWin })}`)
      }
    })
  )
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
    Effect.provide(workerProgram, rlStatsLayer),
    StatsServiceLive
  ),
  IPCServiceLive
)

Effect.runPromise(program).catch((err) => {
  console.error('Worker error:', err)
  framed.write(`error:${JSON.stringify(err)}`)
})
