import { Context, Stream, Layer } from 'effect'
import FramedStream from 'framed-stream'

const framed = new FramedStream(Bare.IPC)

export class IPCService extends Context.Tag('@rlstats-tracker/IPC')<
  IPCService,
  { send: (msg: string) => void; messages: Stream.Stream<string> }
>() {}

export const IPCServiceLive = Layer.succeed(IPCService, {
  send: (msg: string) => framed.write(msg),
  messages: Stream.fromEventListener<string>(framed, 'data').pipe(
    Stream.catchAll(() => Stream.fromIterable([]))
  )
})
