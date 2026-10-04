import { Context, Config, Effect, Layer } from 'effect'
import robot from 'robotjs'

export class ReplayService extends Context.Tag('@rlstats-tracker/Replay')<
  ReplayService,
  { saveReplay: (replayName: string) => Effect.Effect<void> }
>() {}

export const ReplayServiceLive = Layer.succeed(ReplayService, {
  saveReplay: () =>
    Effect.gen(function* () {
      const shortcut = yield* Config.string('replayShortcut').pipe(Config.withDefault('ctrl+s'))
      const saveReplays = yield* Config.boolean('saveReplays').pipe(Config.withDefault(true))
      if (!saveReplays) return

      yield* Effect.sleep('1 second')

      try {
        yield* Effect.try(() => {
          robot.keyTap(shortcut)
        })
      } catch (err) {
        yield* Effect.logError('[replay] Failed to save replay:', err)
      }
    }).pipe(Effect.catchAll((err) => Effect.logError('[replay]', err)))
})
