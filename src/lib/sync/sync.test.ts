import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { codexAdapter } from "../agents/adapters/codex"
import { closeDb, getDb } from "../db/client.server"
import { syncUsage } from "./sync.server"

let home: string
let dataDir: string

const HEADER = JSON.stringify({
  type: "session",
  id: "sess-1",
  timestamp: "2026-08-01T10:00:00Z",
})

function ompMessage(id: string, output: number, cost?: number): string {
  return JSON.stringify({
    type: "message",
    id,
    timestamp: "2026-08-01T10:05:00Z",
    message: {
      role: "assistant",
      model: "claude-sonnet-4-5",
      provider: "anthropic",
      usage: {
        input: 100,
        output,
        cacheRead: 10,
        cacheWrite: 5,
        ...(cost !== undefined ? { cost: { total: cost } } : {}),
      },
    },
  })
}

function writeOmpSession(lines: string[]): string {
  const dir = join(home, ".omp", "agent", "sessions", "--tmp--proj--")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "session-1.jsonl")
  writeFileSync(path, lines.map((line) => `${line}\n`).join(""))
  return path
}

// A fresh disk cache keeps pricing hermetic: no network fetch happens and
// estimated costs are deterministic ($3/M input, $15/M output, ...).
function writePricingCache(): void {
  const raw = {
    anthropic: {
      models: {
        "claude-sonnet-4-5": {
          cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
        },
      },
    },
  }
  writeFileSync(
    join(dataDir, "models-dev.json"),
    JSON.stringify({ fetchedAt: Date.now(), raw })
  )
}

describe("syncUsage", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "ts-home-"))
    dataDir = mkdtempSync(join(tmpdir(), "ts-data-"))
    vi.stubEnv("TELEMETRY_STATS_DATA_DIR", dataDir)
    // Point every base directory adapters search at the temp home, so a sync never
    // reads the real agent logs. os.homedir() reads USERPROFILE on Windows, not HOME.
    vi.stubEnv("HOME", home)
    vi.stubEnv("USERPROFILE", home)
    vi.stubEnv("APPDATA", join(home, "AppData", "Roaming"))
    vi.stubEnv("LOCALAPPDATA", join(home, "AppData", "Local"))
    vi.stubEnv("XDG_DATA_HOME", join(home, ".local", "share"))
    vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"))
    writePricingCache()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    closeDb()
    rmSync(home, { recursive: true, force: true })
    rmSync(dataDir, { recursive: true, force: true })
  })

  it("migrates stored sources to persisted resume state", () => {
    const path = join(dataDir, "stats.db")
    const legacy = new Database(path)
    legacy.exec(`
      CREATE TABLE sources (
        path TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        adapter_version INTEGER NOT NULL,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        sample_hash TEXT NOT NULL,
        cursor INTEGER,
        warnings INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        last_synced_at INTEGER NOT NULL
      );
      INSERT INTO sources VALUES ('legacy.jsonl', 'codex', 3, 'jsonl', 10, 1, 'hash', NULL, 0, NULL, 1);
      PRAGMA user_version = 1;
    `)
    legacy.close()

    const db = getDb()
    const columns = db.pragma("table_info(sources)") as { name: string }[]
    const source = db
      .prepare("SELECT path, resume_state FROM sources")
      .get() as {
      path: string
      resume_state: string | null
    }
    expect(columns.map((column) => column.name)).toContain("resume_state")
    expect(source).toEqual({ path: "legacy.jsonl", resume_state: null })
  })

  it("imports events once, keeps reported costs, prices the rest", async () => {
    writeOmpSession([HEADER, ompMessage("m1", 50, 0.12), ompMessage("m2", 70)])
    const first = await syncUsage({ agents: ["omp"] })
    expect(first.inserted).toBe(2)

    const rows = getDb()
      .prepare(
        "SELECT cost_usd, cost_source, output_tokens FROM usage_events ORDER BY output_tokens"
      )
      .all() as {
      cost_usd: number | null
      cost_source: string
      output_tokens: number
    }[]
    expect(rows).toHaveLength(2)
    expect(rows[0].cost_source).toBe("reported")
    expect(rows[0].cost_usd).toBeCloseTo(0.12)
    // 100 in * $3/M + 70 out * $15/M + 10 cr * $0.3/M + 5 cw * $3.75/M
    expect(rows[1].cost_source).toBe("estimated")
    expect(rows[1].cost_usd).toBeCloseTo(
      (100 * 3 + 70 * 15 + 10 * 0.3 + 5 * 3.75) / 1_000_000
    )

    const second = await syncUsage({ agents: ["omp"] })
    expect(second.inserted).toBe(0)
    expect(second.skipped).toBeGreaterThan(0)
  })

  it("resumes appended JSONL and defers a partial trailing line", async () => {
    const path = writeOmpSession([HEADER, ompMessage("m1", 50)])
    await syncUsage({ agents: ["omp"] })

    appendFileSync(path, `${ompMessage("m2", 60)}\n`)
    appendFileSync(path, ompMessage("m3", 70).slice(0, 40))
    const second = await syncUsage({ agents: ["omp"] })
    expect(second.inserted).toBe(1)

    appendFileSync(path, `${ompMessage("m3", 70).slice(40)}\n`)
    const third = await syncUsage({ agents: ["omp"] })
    expect(third.inserted).toBe(1)
    const count = getDb()
      .prepare("SELECT COUNT(*) AS n FROM usage_events")
      .get() as { n: number }
    expect(count.n).toBe(3)
  })

  it("resumes appended Codex logs with persisted parser state", async () => {
    const dir = join(home, ".codex", "sessions")
    const path = join(dir, "session.jsonl")
    mkdirSync(dir, { recursive: true })
    const prefix = [
      {
        type: "session_meta",
        payload: { id: "session", model_provider: "openai", cwd: "/work/app" },
      },
      { type: "turn_context", payload: { model: "gpt-5", cwd: "/work/app" } },
      {
        type: "event_msg",
        timestamp: "2026-08-01T10:00:00Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 10,
              cached_input_tokens: 2,
              output_tokens: 4,
              reasoning_output_tokens: 1,
            },
            total_token_usage: {
              input_tokens: 10,
              cached_input_tokens: 2,
              output_tokens: 4,
              reasoning_output_tokens: 1,
            },
          },
        },
      },
    ]
    writeFileSync(
      path,
      `${prefix.map((line) => JSON.stringify(line)).join("\n")}\n`
    )

    const first = await syncUsage({ agents: ["codex"] })
    expect(first.inserted).toBe(1)
    const stored = getDb()
      .prepare("SELECT cursor, resume_state FROM sources WHERE path = ?")
      .get(path) as { cursor: number | null; resume_state: string | null }
    expect(stored.cursor).toBeGreaterThan(0)
    expect(stored.resume_state).not.toBeNull()

    const next = {
      type: "event_msg",
      timestamp: "2026-08-01T10:01:00Z",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 18,
            cached_input_tokens: 4,
            output_tokens: 7,
            reasoning_output_tokens: 2,
          },
        },
      },
    }
    appendFileSync(path, `${JSON.stringify(next)}\n`)
    const second = await syncUsage({ agents: ["codex"] })
    expect(second.inserted).toBe(1)

    const events = getDb()
      .prepare(
        "SELECT input_tokens, output_tokens, cache_read_tokens, reasoning_tokens FROM usage_events ORDER BY timestamp"
      )
      .all() as {
      input_tokens: number
      output_tokens: number
      cache_read_tokens: number
      reasoning_tokens: number
    }[]
    expect(events).toEqual([
      {
        input_tokens: 8,
        output_tokens: 3,
        cache_read_tokens: 2,
        reasoning_tokens: 1,
      },
      {
        input_tokens: 6,
        output_tokens: 2,
        cache_read_tokens: 2,
        reasoning_tokens: 1,
      },
    ])
  })

  it("reparses unresolved Codex usage when later model metadata arrives", async () => {
    const dir = join(home, ".codex", "sessions")
    const path = join(dir, "pending.jsonl")
    mkdirSync(dir, { recursive: true })
    const prefix = [
      {
        type: "session_meta",
        payload: { id: "pending", cwd: "/work/original" },
      },
      {
        type: "event_msg",
        timestamp: "2026-08-01T10:00:00Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: { input_tokens: 10, output_tokens: 4 },
            total_token_usage: { input_tokens: 10, output_tokens: 4 },
          },
        },
      },
    ]
    writeFileSync(
      path,
      `${prefix.map((line) => JSON.stringify(line)).join("\n")}\n`
    )

    await syncUsage({ agents: ["codex"] })
    const stored = getDb()
      .prepare("SELECT cursor, resume_state FROM sources WHERE path = ?")
      .get(path) as { cursor: number | null; resume_state: string | null }
    expect(stored).toEqual({ cursor: null, resume_state: null })

    appendFileSync(
      path,
      `${JSON.stringify({ type: "turn_context", payload: { model: "gpt-5", cwd: "/work/next" } })}\n`
    )
    await syncUsage({ agents: ["codex"] })
    const events = getDb()
      .prepare("SELECT model, project FROM usage_events")
      .all() as { model: string | null; project: string | null }[]
    expect(events).toEqual([{ model: "gpt-5", project: "/work/original" }])
  })

  it("replaces existing Codex rows after an invalid checkpoint", async () => {
    const dir = join(home, ".codex", "sessions")
    const path = join(dir, "invalid-state.jsonl")
    mkdirSync(dir, { recursive: true })
    const prefix = [
      {
        type: "session_meta",
        payload: { id: "invalid-state", cwd: "/work/app" },
      },
      { type: "turn_context", payload: { model: "gpt-5" } },
      {
        type: "event_msg",
        timestamp: "2026-08-01T10:00:00Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: { input_tokens: 10, output_tokens: 4 },
            total_token_usage: { input_tokens: 10, output_tokens: 4 },
          },
        },
      },
    ]
    writeFileSync(
      path,
      `${prefix.map((line) => JSON.stringify(line)).join("\n")}\n`
    )
    await syncUsage({ agents: ["codex"] })
    getDb()
      .prepare("UPDATE sources SET resume_state = 'invalid' WHERE path = ?")
      .run(path)
    getDb().prepare("UPDATE usage_events SET project = '/work/stale'").run()

    appendFileSync(
      path,
      `${JSON.stringify({
        type: "event_msg",
        timestamp: "2026-08-01T10:01:00Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 20, output_tokens: 8 },
          },
        },
      })}\n`
    )
    await syncUsage({ agents: ["codex"] })

    const events = getDb()
      .prepare(
        "SELECT project, input_tokens, output_tokens FROM usage_events ORDER BY timestamp"
      )
      .all() as {
      project: string | null
      input_tokens: number
      output_tokens: number
    }[]
    expect(events).toEqual([
      { project: "/work/app", input_tokens: 10, output_tokens: 4 },
      { project: "/work/app", input_tokens: 10, output_tokens: 4 },
    ])

    getDb()
      .prepare("UPDATE sources SET cursor = size + 1000 WHERE path = ?")
      .run(path)
    getDb().prepare("UPDATE usage_events SET project = '/work/stale'").run()
    appendFileSync(
      path,
      `${JSON.stringify({
        type: "event_msg",
        timestamp: "2026-08-01T10:02:00Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 30, output_tokens: 12 },
          },
        },
      })}\n`
    )
    await syncUsage({ agents: ["codex"] })

    const reparsed = getDb()
      .prepare(
        "SELECT project, input_tokens, output_tokens FROM usage_events ORDER BY timestamp"
      )
      .all() as {
      project: string | null
      input_tokens: number
      output_tokens: number
    }[]
    expect(reparsed).toEqual([
      { project: "/work/app", input_tokens: 10, output_tokens: 4 },
      { project: "/work/app", input_tokens: 10, output_tokens: 4 },
      { project: "/work/app", input_tokens: 10, output_tokens: 4 },
    ])

    getDb()
      .prepare("UPDATE sources SET size = 1.5, cursor = 1 WHERE path = ?")
      .run(path)
    getDb().prepare("UPDATE usage_events SET project = '/work/stale'").run()
    appendFileSync(
      path,
      `${JSON.stringify({
        type: "event_msg",
        timestamp: "2026-08-01T10:03:00Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 40, output_tokens: 16 },
          },
        },
      })}\n`
    )
    await syncUsage({ agents: ["codex"] })

    const sizeReparsed = getDb()
      .prepare(
        "SELECT project, input_tokens, output_tokens FROM usage_events ORDER BY timestamp"
      )
      .all() as {
      project: string | null
      input_tokens: number
      output_tokens: number
    }[]
    expect(sizeReparsed).toEqual([
      { project: "/work/app", input_tokens: 10, output_tokens: 4 },
      { project: "/work/app", input_tokens: 10, output_tokens: 4 },
      { project: "/work/app", input_tokens: 10, output_tokens: 4 },
      { project: "/work/app", input_tokens: 10, output_tokens: 4 },
    ])
  })

  it("replaces Codex events when a rewritten log grows", async () => {
    const dir = join(home, ".codex", "sessions")
    const path = join(dir, "rewritten.jsonl")
    mkdirSync(dir, { recursive: true })
    const original = [
      { type: "session_meta", payload: { id: "rewritten", cwd: "/work/old" } },
      { type: "turn_context", payload: { model: "gpt-old" } },
      {
        type: "event_msg",
        timestamp: "2026-08-01T10:00:00Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: { input_tokens: 10, output_tokens: 4 },
            total_token_usage: { input_tokens: 10, output_tokens: 4 },
          },
        },
      },
    ]
    const originalText = `${original.map((line) => JSON.stringify(line)).join("\n")}\n`
    writeFileSync(path, originalText)
    await syncUsage({ agents: ["codex"] })

    const replacement = [
      { type: "session_meta", payload: { id: "rewritten", cwd: "/work/new" } },
      { type: "turn_context", payload: { model: "gpt-new" } },
      {
        type: "event_msg",
        timestamp: "2026-08-01T11:00:00Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: { input_tokens: 20, output_tokens: 8 },
            total_token_usage: { input_tokens: 20, output_tokens: 8 },
          },
        },
      },
      { type: "ignored", payload: { text: "x".repeat(1000) } },
    ]
    const replacementText = `${replacement.map((line) => JSON.stringify(line)).join("\n")}\n`
    expect(replacementText.length).toBeGreaterThan(originalText.length)
    writeFileSync(path, replacementText)
    await syncUsage({ agents: ["codex"] })

    const events = getDb()
      .prepare(
        "SELECT model, project, input_tokens, output_tokens FROM usage_events"
      )
      .all() as {
      model: string | null
      project: string | null
      input_tokens: number
      output_tokens: number
    }[]
    expect(events).toEqual([
      {
        model: "gpt-new",
        project: "/work/new",
        input_tokens: 20,
        output_tokens: 8,
      },
    ])
  })

  it("retries a stable Codex log after both parse attempts change", async () => {
    const dir = join(home, ".codex", "sessions")
    const path = join(dir, "raced.jsonl")
    mkdirSync(dir, { recursive: true })
    const original = [
      { type: "session_meta", payload: { id: "raced", cwd: "/work/old" } },
      { type: "turn_context", payload: { model: "gpt-old" } },
      {
        type: "event_msg",
        timestamp: "2026-08-01T10:00:00Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: { input_tokens: 10, output_tokens: 4 },
            total_token_usage: { input_tokens: 10, output_tokens: 4 },
          },
        },
      },
    ]
    writeFileSync(
      path,
      `${original.map((line) => JSON.stringify(line)).join("\n")}\n`
    )
    await syncUsage({ agents: ["codex"] })
    appendFileSync(path, `${JSON.stringify({ type: "ignored" })}\n`)

    const replacement = [
      { type: "session_meta", payload: { id: "raced", cwd: "/work/new" } },
      { type: "turn_context", payload: { model: "gpt-new" } },
      {
        type: "event_msg",
        timestamp: "2026-08-01T11:00:00Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: { input_tokens: 20, output_tokens: 8 },
            total_token_usage: { input_tokens: 20, output_tokens: 8 },
          },
        },
      },
      { type: "ignored", payload: { text: "x".repeat(1000) } },
    ]
    const originalParse = codexAdapter.parse
    let changes = 0
    codexAdapter.parse = async (source, context) => {
      changes++
      if (changes === 1) {
        writeFileSync(
          path,
          `${replacement.map((line) => JSON.stringify(line)).join("\n")}\n`
        )
      } else if (changes === 2) {
        appendFileSync(path, `${JSON.stringify({ type: "ignored-again" })}\n`)
      }
      return originalParse(source, context)
    }
    try {
      const unstable = await syncUsage({ agents: ["codex"] })
      expect(unstable.processed).toBe(0)
      expect(unstable.warnings).toBe(3)
      const source = getDb()
        .prepare("SELECT warnings, error FROM sources WHERE path = ?")
        .get(path) as { warnings: number; error: string | null }
      expect(source).toEqual({
        warnings: 0,
        error: "source changed while parsing",
      })
    } finally {
      codexAdapter.parse = originalParse
    }
    const recovered = await syncUsage({ agents: ["codex"] })
    expect(recovered.processed).toBe(1)

    const events = getDb()
      .prepare(
        "SELECT model, project, input_tokens, output_tokens FROM usage_events"
      )
      .all() as {
      model: string | null
      project: string | null
      input_tokens: number
      output_tokens: number
    }[]
    expect(events).toEqual([
      {
        model: "gpt-new",
        project: "/work/new",
        input_tokens: 20,
        output_tokens: 8,
      },
    ])
  })

  it("keeps accepted warnings and discards abandoned warnings", async () => {
    const dir = join(home, ".codex", "sessions")
    const path = join(dir, "warnings.jsonl")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path,
      `${JSON.stringify({ type: "session_meta", payload: { id: "warnings" } })}\n${JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } })}\n`
    )
    await syncUsage({ agents: ["codex"] })
    appendFileSync(path, `${JSON.stringify({ type: "ignored" })}\n`)

    const originalParse = codexAdapter.parse
    let changed = false
    codexAdapter.parse = async (source, context) => {
      if (!changed) {
        changed = true
        context.warn("discarded warning")
        appendFileSync(path, `${JSON.stringify({ type: "ignored-again" })}\n`)
      }
      return originalParse(source, context)
    }
    try {
      const result = await syncUsage({ agents: ["codex"] })
      expect(result.warnings).toBe(1)
      const source = getDb()
        .prepare("SELECT warnings, error FROM sources WHERE path = ?")
        .get(path) as { warnings: number; error: string | null }
      expect(source).toEqual({ warnings: 0, error: null })
    } finally {
      codexAdapter.parse = originalParse
    }

    appendFileSync(path, `${JSON.stringify({ type: "ignored-third" })}\n`)
    codexAdapter.parse = async (source, context) => {
      context.warn("accepted warning")
      return originalParse(source, context)
    }
    try {
      const result = await syncUsage({ agents: ["codex"] })
      expect(result.warnings).toBe(1)
      const source = getDb()
        .prepare("SELECT warnings, error FROM sources WHERE path = ?")
        .get(path) as { warnings: number; error: string | null }
      expect(source).toEqual({ warnings: 1, error: null })
    } finally {
      codexAdapter.parse = originalParse
    }
  })

  it("replaces events when a file is rewritten in place", async () => {
    const path = writeOmpSession([
      HEADER,
      ompMessage("m1", 50),
      ompMessage("m2", 60),
    ])
    await syncUsage({ agents: ["omp"] })

    writeFileSync(path, `${HEADER}\n${ompMessage("m9", 99)}\n`)
    await syncUsage({ agents: ["omp"] })
    const rows = getDb()
      .prepare("SELECT output_tokens FROM usage_events")
      .all() as {
      output_tokens: number
    }[]
    expect(rows.map((row) => row.output_tokens)).toEqual([99])
  })

  it("leaves costs null and unpriced for unknown models without a catalog", async () => {
    rmSync(join(dataDir, "models-dev.json"))
    // Without a cached catalog the loader fetches models.dev; keep the test offline so
    // a slow network can't time it out and leave its sync running into the next test.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    writeOmpSession([
      HEADER,
      JSON.stringify({
        type: "message",
        id: "mx",
        timestamp: "2026-08-01T10:05:00Z",
        message: {
          role: "assistant",
          model: "mystery-model",
          provider: "nowhere",
          usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 },
        },
      }),
    ])
    await syncUsage({ agents: ["omp"] })
    const row = getDb()
      .prepare("SELECT cost_usd, cost_source FROM usage_events")
      .get() as {
      cost_usd: number | null
      cost_source: string
    }
    expect(row.cost_source).toBe("unpriced")
    expect(row.cost_usd).toBeNull()
  })

  it("joins concurrent sync calls into one run", async () => {
    writeOmpSession([HEADER, ompMessage("m1", 50)])
    const [first, second] = await Promise.all([
      syncUsage({ agents: ["omp"] }),
      syncUsage({ agents: ["omp"] }),
    ])
    expect(first).toBe(second)
  })
})
