import { Context, Effect } from 'effect'

export class UIService extends Context.Tag('@rlstats-tracker/UI')<
  UIService,
  {
    log(message: string): Effect.Effect<void>
    promptPlayer(names: string[], currentStored: string): Effect.Effect<string>
  }
>() {}
