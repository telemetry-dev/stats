# Telemetry Stats

Telemetry Stats is a local dashboard for token usage and cost across AI coding
agents. It reads the usage logs and databases that about 50 agents already write
on your machine, stores the usage numbers in a local SQLite database, and shows
them in your browser.

![The Telemetry Stats dashboard](https://raw.githubusercontent.com/telemetry-dev/stats/main/.github/preview.png)

## Quick start

You need Node.js 22 or newer.

```bash
npx @telemetry-dev/stats
```

This syncs your agent logs, starts the dashboard at http://127.0.0.1:3847, and
opens it in your browser. To install the command globally instead:

```bash
npm i -g @telemetry-dev/stats
telemetry-stats
```

You can also skip the dashboard and print results in the terminal:

```bash
telemetry-stats --sync   # sync, then print a summary
telemetry-stats --json   # sync, then print totals and per-agent and per-model breakdowns as JSON
```

## Options

| Option             | Default     | Description                         |
| ------------------ | ----------- | ----------------------------------- |
| `-p`, `--port <n>` | `3847`      | Port for the dashboard server       |
| `--host <addr>`    | `127.0.0.1` | Address to bind                     |
| `--no-open`        |             | Don't open the browser              |
| `-s`, `--sync`     |             | Sync, print a summary, and exit     |
| `-j`, `--json`     |             | Sync, print stats as JSON, and exit |
| `-h`, `--help`     |             | Show help                           |

If the port is already used by another Telemetry Stats dashboard, the command
reuses that dashboard. If something else holds the port, it tries the next free
port.

> [!WARNING]
> The dashboard and its API have no authentication. With the default host only
> your own machine can reach it. `--host 0.0.0.0` exposes your usage data to
> your network, along with the `/api/settings` and `/api/sync` endpoints, which
> let anyone who can reach the port change settings and start syncs.

## How syncing works

Starting the dashboard runs a sync in the background, and the **Sync** button
runs another. Syncs are incremental: files that haven't changed since the last
sync are skipped. Most JSONL logs that only grew are read from where the last
sync stopped; other changed files, including Claude Code logs and SQLite
databases, are read again in full. Open pages refresh their data every 30
seconds, and within a few seconds of a sync finishing.

The **Settings** page lists each agent whose data it found, as ok or error, and
the agents still waiting for tokscale files, as sync required. It also lets you
set:

- **Extra roots** to scan, for agent data stored outside the default
  locations. Each must be an existing absolute path. Not every agent checks
  them, and each agent expects its own folder layout inside them; see its
  adapter in `src/lib/agents/adapters/`.
- **Timezone** used for daily totals. It defaults to your system timezone on the
  first run.

## Supported agents

Telemetry Stats reads data that each agent writes locally. It doesn't need an
account or API key of its own.

Five agents don't write usage records that Telemetry Stats can read directly.
For these it reads files under `~/.config/tokscale` (or
`$XDG_CONFIG_HOME/tokscale`), the folder of the separate
[tokscale](https://github.com/junhoyeo/tokscale) tool: the caches that tokscale
syncs for Cursor IDE, Google Antigravity, Trae, and Warp / Oz, and MiniMax Code
headless output saved in tokscale's `headless/mcode` folder. Until those files
exist, the Settings page lists these agents as "sync required".

<details>
<summary>Where each agent's data is read from</summary>

`<data>` means `$XDG_DATA_HOME` if set, otherwise `~/.local/share`, on every
platform. `**` means any number of subdirectories.

| Agent              | Reads                                                                                                                                                                                        | Env override                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Claude Code        | `~/.claude/projects/**/*.jsonl`, `~/.claude/transcripts/**/*.jsonl`                                                                                                                          |                                                                            |
| Codex CLI          | `~/.codex/sessions/**/*.jsonl`, `~/.codex/archived_sessions/**/*.jsonl`. Sakana Fugu usage in these sessions is shown as its own agent.                                                      | `CODEX_HOME`                                                               |
| Gemini CLI         | `~/.gemini/tmp/**/chats/**/*.json`                                                                                                                                                           | `GEMINI_CLI_HOME`                                                          |
| OpenCode           | `<data>/opencode/**/opencode.db` and `opencode-*.db`, `<data>/opencode/storage/message/**/*.json`                                                                                            | `XDG_DATA_HOME`                                                            |
| Amp                | `<data>/amp/threads/**/*.json`                                                                                                                                                               | `XDG_DATA_HOME`                                                            |
| Droid              | `~/.factory/sessions/**/*.settings.json`                                                                                                                                                     |                                                                            |
| Pi                 | `~/.pi/agent/sessions/**/*.jsonl`                                                                                                                                                            |                                                                            |
| Oh My Pi           | `~/.omp/agent/sessions/**/*.jsonl`                                                                                                                                                           |                                                                            |
| Qwen CLI           | `~/.qwen/projects/**/*.jsonl`                                                                                                                                                                |                                                                            |
| Kimi               | `~/.kimi/sessions/**/*.jsonl`, `~/.kimi-code/sessions/**/*.jsonl`                                                                                                                            | `KIMI_CODE_HOME` (replaces `~/.kimi-code`)                                 |
| Mux                | `~/.mux/sessions/**/*.jsonl`                                                                                                                                                                 |                                                                            |
| Grok Build         | `~/.grok/sessions/**/updates.jsonl`                                                                                                                                                          | `GROK_HOME`                                                                |
| OpenClaw           | `~/.openclaw/agents/**/*.jsonl`, plus the same under `~/.clawdbot`, `~/.moltbot`, and `~/.moldbot`                                                                                           |                                                                            |
| Prime Agent        | `~/.prime/agent/sessions/**/*.jsonl`, `~/.prime/agent/session-artifacts/**/*.jsonl`                                                                                                          |                                                                            |
| Senpi              | `~/.senpi/agent/sessions/**/*.jsonl`                                                                                                                                                         | `SENPI_CODING_AGENT_DIR`                                                   |
| Kimchi Coding      | `~/.config/kimchi/harness/sessions/**/*.jsonl`                                                                                                                                               | `KIMCHI_CODING_AGENT_DIR`                                                  |
| Reasonix           | `~/.reasonix/stats/**/*.jsonl`                                                                                                                                                               | `REASONIX_STATE_HOME`, then `REASONIX_HOME`                                |
| Gajae-Code         | `~/.gjc/agent/sessions/**/*.jsonl`, plus `$XDG_DATA_HOME/gjc/sessions` if `XDG_DATA_HOME` is set                                                                                             | `GJC_CODING_AGENT_DIR`; `GJC_CONFIG_DIR` or `PI_CONFIG_DIR`                |
| Jcode              | `~/.jcode/sessions/**/session_*.json`, `session_*.journal.jsonl`                                                                                                                             | `JCODE_HOME`                                                               |
| Junie              | `~/.junie/sessions/**/events.jsonl`                                                                                                                                                          |                                                                            |
| Augment Code       | `~/.augment/sessions/**/*.json`                                                                                                                                                              |                                                                            |
| OpenCodeReview     | `~/.opencodereview/sessions/**/*.jsonl`                                                                                                                                                      |                                                                            |
| CodeBuddy          | `~/.codebuddy/projects/**/*.jsonl`                                                                                                                                                           |                                                                            |
| WorkBuddy          | `~/.workbuddy/projects/**/*.jsonl`                                                                                                                                                           |                                                                            |
| Cherry Studio      | `CherryStudio/Data/Agents/.claude/projects/**/*.jsonl` and `CherryStudio/.claude/projects/**/*.jsonl` in `~/Library/Application Support` (macOS), `%APPDATA%` (Windows), or `~/.config`      | `XDG_CONFIG_HOME` (Linux)                                                  |
| Command Code       | `~/.commandcode/projects/**/*.jsonl`                                                                                                                                                         |                                                                            |
| DeepSeek Harness   | `~/.dsh/sessions/**/session.jsonl` and `session.jsonl.zstd`                                                                                                                                  | `DSH_HOME`                                                                 |
| Codebuff           | `~/.config/manicode/**/chat-messages.json`, plus `manicode-dev` and `manicode-staging`                                                                                                       | `CODEBUFF_DATA_DIR`                                                        |
| Freebuff           | Same files as Codebuff                                                                                                                                                                       | `FREEBUFF_DATA_DIR`                                                        |
| Hermes Agent       | `~/.hermes/state.db`, `~/.hermes/profiles/*/state.db`                                                                                                                                        | `HERMES_HOME`                                                              |
| Kilo CLI           | `<data>/kilo/kilo.db`                                                                                                                                                                        | `XDG_DATA_HOME`                                                            |
| Goose              | `~/.local/share/goose/sessions/sessions.db` and `~/Library/Application Support/goose/sessions/sessions.db`, plus the older `Block/goose` versions of both                                    | `GOOSE_PATH_ROOT`                                                          |
| Zed Agent          | `~/Library/Application Support/Zed/threads/threads.db` (macOS), `<data>/zed/threads/threads.db` (Linux), `%LOCALAPPDATA%\Zed\threads\threads.db` (Windows)                                   |                                                                            |
| Kiro               | `~/.kiro/sessions/cli/**/*.json` and `*.jsonl`, `kiro-cli/data.sqlite3`, `Kiro/User/globalStorage/kiro.kiroagent/data.sqlite3` (both databases in the same per-platform folder as Zed Agent) |                                                                            |
| Antigravity CLI    | `~/.gemini/antigravity-cli/conversations/**/*.db`                                                                                                                                            | `GEMINI_CLI_HOME`                                                          |
| MiMo Code          | `<data>/mimocode/mimocode.db`                                                                                                                                                                | `XDG_DATA_HOME`                                                            |
| ZCode              | `~/.zcode/cli/db/db.sqlite`, `~/.zcode/projects/**/*.jsonl`                                                                                                                                  |                                                                            |
| Devin CLI          | `<data>/devin/cli/sessions.db`                                                                                                                                                               | `XDG_DATA_HOME`                                                            |
| Devin Desktop      | `Devin/User/acp-events/**/*.json` and `*.jsonl` in `~/Library/Application Support` (macOS), `%APPDATA%` (Windows), or `~/.config`                                                            | `XDG_CONFIG_HOME` (Linux)                                                  |
| Octofriend         | `<data>/octofriend/sqlite.db`. Usage through Synthetic is shown as its own agent.                                                                                                            | `XDG_DATA_HOME`                                                            |
| Crush              | `<data>/crush/projects.json`, then the `crush.db` of each project it lists                                                                                                                   | `XDG_DATA_HOME`                                                            |
| Cline              | `Code/User/globalStorage/saoudrizwan.claude-dev/tasks/**/ui_messages.json` like Roo Code, and CLI sessions in `~/.cline/data/sessions/**/*.messages.json`                                    | `CLINE_SESSION_DATA_DIR`, `CLINE_DATA_DIR`, `CLINE_DIR`                    |
| GitHub Copilot CLI | `~/.copilot/otel/**/*.jsonl`                                                                                                                                                                 | `COPILOT_OTEL_FILE_EXPORTER_PATH` (read in addition)                       |
| Roo Code           | `Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks/**/ui_messages.json` in the VS Code config folder, and the same under `~/.vscode-server/data`                                      | `XDG_CONFIG_HOME` (Linux)                                                  |
| Kilo               | Same as Roo Code, with the `kilocode.kilo-code` extension folder                                                                                                                             | `XDG_CONFIG_HOME` (Linux)                                                  |
| Cursor IDE         | `~/.config/tokscale/cursor-cache/usage.csv` and `usage.*.csv` (tokscale cache)                                                                                                               | `XDG_CONFIG_HOME`                                                          |
| Google Antigravity | `~/.config/tokscale/antigravity-cache/sessions/**/*.jsonl` (tokscale cache)                                                                                                                  | `XDG_CONFIG_HOME`                                                          |
| Trae               | `~/.config/tokscale/trae-cache/sessions/**/*.json` (tokscale cache)                                                                                                                          | `XDG_CONFIG_HOME`                                                          |
| Warp / Oz          | `~/.config/tokscale/warp-cache/usage.json` (tokscale cache)                                                                                                                                  | `XDG_CONFIG_HOME`                                                          |
| MiniMax Code       | `~/.config/tokscale/headless/mcode/**/*.jsonl` (MiniMax Code headless output saved in tokscale's headless folder)                                                                            | `TOKSCALE_HEADLESS_DIR` (reads its `mcode` folder), else `XDG_CONFIG_HOME` |

</details>

## Privacy and data

Your usage data never leaves your machine unless you share it yourself (see
[Share your stats](#share-your-stats)).

### What's stored

For each request, Telemetry Stats stores usage metadata only: agent, model,
provider, session ID, project path, timestamp, duration, token counts, cost and
whether the agent reported it, a message or request ID to remove duplicates, and
the path of the log file it came from. It also keeps per-file sync bookkeeping
(file size, modification time, a hash of sampled file content, how far it has
read, and the last read error), a history of syncs, and your settings. It never
stores prompts, responses, tool arguments, or credentials.

### Where it's stored

Everything is in one directory:

| Platform | Directory                                                             |
| -------- | --------------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/telemetry-stats`                       |
| Linux    | `$XDG_DATA_HOME/telemetry-stats`, or `~/.local/share/telemetry-stats` |
| Windows  | `%LOCALAPPDATA%\telemetry-stats`                                      |

Set `TELEMETRY_STATS_DATA_DIR` to use a different directory. It contains:

- `stats.db`, with its `stats.db-wal` and `stats.db-shm` files: the SQLite
  database with usage, sync state, and settings
- `models-dev.json`: the cached price catalog
- `sync.lock`: present while a sync is running

To reset everything, stop the dashboard and delete the directory. The next run
rebuilds the database from whatever agent logs are still on disk.

### The one outbound request

To price usage, Telemetry Stats downloads the public price catalog from
[models.dev](https://models.dev) with a GET to `https://models.dev/api.json`.
It reuses the cached copy for an hour before downloading again. If the download
fails, costs use the last cached copy, or show as unpriced if there's no cache
yet. The request sends no usage data.

### How costs are calculated

Costs recorded by an agent are kept as reported. Other requests are priced from
the models.dev catalog, and `--json` reports their total as `estimatedCostUsd`.
The lookup tries the exact provider and model first, then the model ID alone if
it's unambiguous, then the rates that a strict plurality of providers agree on
for that model ID (model aggregators often keep listing models that the original
provider has dropped). Models that still don't match stay "unpriced" and are
never silently added to a total.

## Share your stats

The **Share stats** button on the overview page draws a card with your usage for
the selected period. The image is built in your browser and never uploaded.
You can download it as a PNG, or use **Post on X**, which opens an X draft with
a caption containing your total token count and downloads the image for you to
attach. Nothing is posted until you post it. Project names, session names, and
filter values are never included.

![Example share card](https://raw.githubusercontent.com/telemetry-dev/stats/main/.github/usage-card.png)

## Development

```bash
npm install
npm run dev         # dev server on http://localhost:3000
npm test            # vitest
npm run typecheck   # tsc
npm run lint        # eslint
npm run check       # prettier check (JS and TS files)
npm run format      # prettier write (JS and TS files)
npm run build       # server, client, and headless CLI into .output/
node bin/telemetry-stats.mjs --no-open
```

## About

Telemetry Stats is built by the [telemetry.dev](https://telemetry.dev) team. It
is a standalone tool and sends nothing to telemetry.dev.

## License

[MIT](https://github.com/telemetry-dev/stats/blob/main/LICENSE)
