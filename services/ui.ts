import { Context, Effect } from 'effect'

export class UIService extends Context.Tag('@rlstats-tracker/UI')<
  UIService,
  {
    log(message: string): void
    promptPlayer(names: string[], currentStored: string): Effect.Effect<string>
  }
>() {}
