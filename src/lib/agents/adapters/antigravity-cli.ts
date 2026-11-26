import { access } from "node:fs/promises"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import type {
  AgentAdapter,
  ParseContext,
  ParseOutput,
  UsageSource,
} from "../types"
import { envPath } from "../types"
import { walkFiles } from "../../usage/parse"
import { hasTokens, makeUsageEvent } from "./shared/json"
import { parseSqliteUsage } from "./shared/sqlite"

export const antigravityCliAdapter: AgentAdapter = {
  id: "antigravity-cli",
  label: "Antigravity CLI",
  version: 2,
  async *discover(context) {
    const gemini =
      envPath(context.env, "GEMINI_CLI_HOME") ?? join(context.home, ".gemini")
    const roots = [
      join(gemini, "antigravity-cli", "conversations"),
      ...context.extraRoots,
    ]
    for (const root of roots) {
      for (const path of await walkFiles(root, (name) =>
        name.endsWith(".db")
      )) {
        try {
          await access(path)
          yield {
            agent: "antigravity-cli",
            path,
            kind: "sqlite",
          } satisfies UsageSource
        } catch {
          // Files can disappear while discovery runs.
        }
      }
    }
  },
  async parse(source, context) {
    const db = new Database(source.path, {
      readonly: true,
      fileMustExist: true,
    })
    try {
      const native = db.transaction(() => {
        const tables = new Set(
          db
            .prepare<[], string>(
              "SELECT name FROM sqlite_schema WHERE type IN ('table', 'view')"
            )
            .pluck()
            .all()
        )
        return tables.has("gen_metadata") && !tables.has("usage_events")
          ? parseGenerations(db, tables, source, context)
          : null
      })()
      if (native) return native
    } finally {
      db.close()
    }
    return parseSqliteUsage(source, context, {
      agent: "antigravity-cli",
      allowMissingUsageEvents: true,
      query: `
        SELECT id, conversation_id AS session_id, timestamp, provider, model,
          project, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, reasoning_tokens, cost_usd, duration_ms,
          id AS dedup_key
        FROM usage_events
      `,
    })
  },
}

function parseGenerations(
  db: Database.Database,
  tables: ReadonlySet<string>,
  source: UsageSource,
  context: ParseContext
): ParseOutput {
  const sessionId = basename(source.path, ".db")
  const metadata = tables.has("trajectory_metadata_blob")
    ? readMetadata(
        db
          .prepare(
            "SELECT data FROM trajectory_metadata_blob WHERE id = 'main'"
          )
          .pluck()
          .get(),
        context
      )
    : null
  const sessionTime = timestamp(message(metadata, 2))
  const workspace = text(message(metadata, 1), 1)
  let project: string | null = null
  if (workspace) {
    try {
      project = fileURLToPath(workspace)
    } catch {
      // A remote workspace URI has no local project path.
    }
  }

  const stepTimes = new Map<string, number>()
  if (tables.has("steps")) {
    for (const data of db
      .prepare("SELECT metadata FROM steps ORDER BY idx")
      .pluck()
      .iterate()) {
      const step = readMetadata(data, context)
      const responseId = text(message(step, 9), 11)
      const at = timestamp(message(step, 1))
      if (responseId && at !== null && !stepTimes.has(responseId))
        stepTimes.set(responseId, at)
    }
  }

  const events = []
  const generations = db.prepare<[], { idx: number; data: unknown }>(
    "SELECT idx, data FROM gen_metadata ORDER BY idx"
  )
  for (const { idx, data } of generations.iterate()) {
    // GeneratorMetadata.chat_model (#1) contains ModelUsageStats (#4).
    const modelData = message(readMetadata(data, context), 1)
    const usage = message(modelData, 4)
    if (!usage) continue

    // Total output includes thinking. Store only response output in the output bucket.
    const reasoning = count(usage, 9)
    const tokens = {
      input: count(usage, 2),
      output: count(usage, 10) || Math.max(0, count(usage, 3) - reasoning),
      cacheRead: count(usage, 5),
      cacheWrite: count(usage, 4),
      reasoning,
    }
    if (!hasTokens(tokens)) continue

    const responseId = text(usage, 11)
    // Older databases store the generation time directly. Newer ones record it in steps.
    const at =
      timestamp(message(message(modelData, 9), 4)) ??
      (responseId ? stepTimes.get(responseId) : undefined) ??
      sessionTime
    if (at === null) {
      context.warn("Skipped Antigravity CLI generation without a timestamp")
      continue
    }

    const model = text(modelData, 19)
    events.push(
      makeUsageEvent(
        "antigravity-cli",
        source,
        context,
        {
          identity: responseId ?? `${sessionId}:${idx}`,
          dedupKey: responseId,
          provider: model?.startsWith("gemini-") ? "google" : null,
          model,
          sessionId,
          project,
          timestamp: at,
          tokens,
        },
        idx
      )
    )
  }
  return { events }
}

type Fields = Map<number, number | Buffer>

function readMetadata(data: unknown, context: ParseContext): Fields | null {
  if (data === null || data === undefined) return null
  try {
    if (Buffer.isBuffer(data)) return readFields(data)
  } catch {
    // Warn once for a malformed root message.
  }
  context.warn("Skipped malformed Antigravity CLI metadata")
  return null
}

function message(fields: Fields | null, id: number): Fields | null {
  const value = fields?.get(id)
  if (!Buffer.isBuffer(value)) return null
  try {
    return readFields(value)
  } catch {
    return null
  }
}

function text(fields: Fields | null, id: number): string | null {
  const value = fields?.get(id)
  return Buffer.isBuffer(value) ? value.toString("utf8").trim() || null : null
}

function count(fields: Fields, id: number): number {
  const value = fields.get(id)
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0
}

function timestamp(fields: Fields | null): number | null {
  if (!fields) return null
  const seconds = count(fields, 1)
  const nanos = count(fields, 2)
  if (seconds < 1e9 || seconds >= 1e10 || nanos >= 1e9) return null
  return seconds * 1000 + Math.floor(nanos / 1e6)
}

// Decode the protobuf wire types used in the conversation metadata. Nested
// messages and large opaque payloads remain slices until a field is needed.
function readFields(data: Buffer): Fields {
  const fields: Fields = new Map()
  let offset = 0
  function varint(): number {
    let value = 0
    for (let shift = 0; shift <= 63 && offset < data.length; shift += 7) {
      const byte = data[offset++]
      value += (byte & 0x7f) * 2 ** shift
      if (byte < 0x80 && (shift < 63 || byte < 2)) return value
    }
    throw new Error("Invalid protobuf varint")
  }

  while (offset < data.length) {
    const tag = varint()
    if (tag < 8 || tag > 0xffffffff) throw new Error("Invalid protobuf tag")
    const id = tag >>> 3
    switch (tag & 7) {
      case 0:
        fields.set(id, varint())
        break
      case 2: {
        const size = varint()
        if (size > data.length - offset)
          throw new Error("Truncated protobuf field")
        fields.set(id, data.subarray(offset, offset + size))
        offset += size
        break
      }
      case 1:
        offset += 8
        break
      case 5:
        offset += 4
        break
      default:
        throw new Error("Unsupported protobuf wire type")
    }
    if (offset > data.length) throw new Error("Truncated protobuf field")
  }
  return fields
}
