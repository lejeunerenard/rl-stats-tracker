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

### Config File

Create `~/.rl-stats.json` to persist your username across runs:

```json
{
  "username": "SqueakyClean"
}
```

When a config file exists, `--username` is optional. The config can be overridden at any time with the flag.

### Interactive Player Selection

If the stored username doesn't match any player in a match, the app will prompt you to select from the current player list:

```
Could not match stored username "MyPlayer" to any player in the game.
Here are the players currently in the match:

  1. SqueakyClean
  2. PlayerTwo
  3. MyPlayer-NA

Enter the number of the player you want to track, or type the name directly:
```

Selecting a player updates the config file automatically.

### Flexible Name Matching

The app uses flexible matching to handle encoding differences:

- Unicode NFC/NFD normalization
- Case-insensitive comparison
- Whitespace normalization
- Substring matching (e.g., "MyPlayer" matches "MyPlayer-NA")

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
