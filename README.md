# rl-stats-tracker

> Rocket League Stats Tracker — tracks wins/losses via the RL Stats API.

A standalone CLI that connects to the Rocket League Stats API websocket (`127.0.0.1:49123`) and tracks a player's wins, losses, and match history in real-time.

## Requirements

- `npm` via [Node.js][nodejs]
- [Bare runtime][bare]
- Rocket League with Stats API enabled (`PacketSendRate > 0` in `DefaultStatsAPI.ini`)

## Getting Started

### Install Dependencies

```sh
npm install
```

### Build Dependencies

The `rl-stats-api` dependency must be compiled before use:

```sh
npm run build
```

*Note:* Will be unnecessary eventually. Still experimental.

### Run

```sh
npm start -- --username <player name>
```

Example:

```sh
npm start -- --username SqueakyClean
```

## Architecture

## Project Structure

- `bin.mjs` — CLI entrypoint and runtime wiring
- `app.ts` — App class (ReadyResource wrapper, worker spawning, IPC framing)
- `workers/main.ts` — Effect v3 worker program (stats tracking, event processing)

## Troubleshooting

- **No stats appearing**: Ensure `PacketSendRate > 0` in Rocket League's `DefaultStatsAPI.ini`
- **Connection errors**: Verify Rocket League is running (Stats API websocket on `127.0.0.1:49123`)

<!-- Reference Links -->

[bare]: https://github.com/holepunchto/bare
[Bare runtime]: https://docs.bare.run
[nodejs]: https://nodejs.org
