import process from 'bare-process'
import { Effect, Layer, Context } from 'effect'
import { UIService } from './ui.js'

export const CLIServiceLive = Layer.succeed(UIService, {
  log(message: string): void {
    console.error(message)
  },

  promptPlayer(names: string[], currentStored: string): Effect.Effect<string> {
    return Effect.async((resume) => {
      this.log('')
      this.log(`Could not match stored username "${currentStored}" to any player in the game.`)
      this.log(`Here are the players currently in the match:`)
      this.log('')

      names.forEach((name, i) => {
        this.log(`  ${i + 1}. ${name}`)
      })

      this.log('')
      this.log(`Enter the number of the player you want to track, or type the name directly:`)

      process.stdout.write(
        JSON.stringify({ type: 'prompt', prompt: { names, currentStored } }) + '\n'
      )

      const stdin = process.stdin
      stdin.setRawMode(true)

      let buffer = ''
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString()

        if (buffer.includes('\n') || buffer.includes('\r')) {
          const input = buffer.trim().replace(/\r?\n/, '')
          buffer = ''

          let selectedName: string | null = null

          const num = parseInt(input, 10)
          if (!isNaN(num) && num >= 1 && num <= names.length) {
            selectedName = names[num - 1]
          }

          if (!selectedName) {
            for (const name of names) {
              if (name.toLowerCase().trim() === input.toLowerCase().trim()) {
                selectedName = name
                break
              }
            }
          }

          if (selectedName) {
            this.log(`Selected: ${selectedName}`)
            stdin.setRawMode(false)
            stdin.removeListener('data', onData)
            process.removeListener('SIGINT', onSigInt)
            resume(Effect.succeed(selectedName))
          } else {
            this.log(
              `Invalid selection. Enter a number (1-${names.length}) or the exact player name:`
            )
          }
        }
      }

      stdin.on('data', onData)

      const onSigInt = () => {
        stdin.setRawMode(false)
        stdin.removeListener('data', onData)
        process.exit(130)
      }
      process.on('SIGINT', onSigInt)
    })
  }
})
