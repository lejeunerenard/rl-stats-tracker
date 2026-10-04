import { Context, Config, Effect, Layer } from 'effect'
import robot from 'robotjs'

export class ReplayService extends Context.Tag('@rlstats-tracker/Replay')<
  ReplayService,
  { saveReplay: (replayName: string) => Effect.Effect<void> }
>() {}

export const ReplayServiceLive = Layer.succeed(ReplayService, {
  saveReplay: () =>
    Effect.gen(function* () {
      const shortcut = yield* Config.string('replayShortcut').pipe(Config.withDefault('end'))
      const saveReplays = yield* Config.boolean('saveReplays').pipe(Config.withDefault(true))
      if (!saveReplays) return

      yield* Effect.log('shortcut', shortcut)

      // Pause from event
      yield* Effect.sleep('1 second')

      // Press, wait un-press
      yield* Effect.try(() => {
        robot.keyToggle(shortcut, 'down')
      })
      yield* Effect.sleep('10 second')
      yield* Effect.try(() => {
        robot.keyToggle(shortcut, 'up')
      })
    }).pipe(Effect.catchAll((err) => Effect.logError('[replay]', err)))
})
