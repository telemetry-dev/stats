import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, test, vi } from "vitest"
import type { AgentAdapter, DiscoveryContext, UsageSource } from "../types"
import { ampAdapter } from "./amp"
import { droidAdapter } from "./droid"
import { geminiCliAdapter } from "./gemini-cli"

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

async function first(adapter: AgentAdapter, home: string, env: Record<string, string | undefined> = {}): Promise<UsageSource> {
  const context: DiscoveryContext = { platform: "darwin", home, env, extraRoots: [] }
  for await (const source of adapter.discover(context)) return source
  throw new Error("source not found")
}

const parseContext = () => ({ timezone: "UTC", warn: vi.fn() })

describe("whole-file JSON adapters", () => {
  test("Gemini honors its home override and maps thoughts", async () => {
    const home = await mkdtemp(join(tmpdir(), "stats-gemini-"))
    const geminiHome = join(home, "gemini-home")
    const path = join(geminiHome, "tmp", "project", "chats", "chat.json")
    await json(path, { id: "chat", startTime: "2026-01-02T00:00:00Z", messages: [{ id: "m", role: "assistant", timestamp: "2026-01-02T00:00:01Z", model: "gemini-3", content: "secret", tokens: { input: 8, output: 4, cached: 2, thoughts: 3 } }] })
    const source = await first(geminiCliAdapter, home, { GEMINI_CLI_HOME: geminiHome })
    const event = (await geminiCliAdapter.parse(source, parseContext())).events[0]
    // Gemini's input count includes cached content tokens; cached is split out.
    expect(event?.tokens).toEqual({ input: 6, output: 4, cacheRead: 2, cacheWrite: 0, reasoning: 3 })
    expect(JSON.stringify(event)).not.toContain("secret")
  })

  test("Amp prefers ledger usage and reported credits", async () => {
    const home = await mkdtemp(join(tmpdir(), "stats-amp-"))
    const data = join(home, "data")
    const path = join(data, "amp", "threads", "T-one.json")
    // Native paths and file URLs: Windows rejects a file URL without a drive.
    const worktree = join(home, "worktree")
    await json(path, { id: "thread", created: 1767312000000, env: { initial: { workspaceRoot: `${worktree}${sep}`, trees: [{ uri: pathToFileURL(join(home, "other")).href, repository: { url: "/work/other" } }, { uri: pathToFileURL(worktree).href, repository: { url: "/work/app/." } }] } }, messages: [{ role: "assistant", usage: { model: "wrong", inputTokens: 99 } }], usageLedger: { events: [{ timestamp: "2026-01-02T00:00:00Z", model: "claude-sonnet", credits: 0.25, tokens: { input: 11, output: 5, cacheReadInputTokens: 3, cacheCreationInputTokens: 2 } }] } })
    const source = await first(ampAdapter, home, { XDG_DATA_HOME: data })
    expect((await ampAdapter.parse(source, parseContext())).events[0]).toMatchObject({ project: resolve("/work/app"), tokens: { input: 11, output: 5, cacheRead: 3, cacheWrite: 2, reasoning: 0 }, costUsd: 0.25, costSource: "reported" })
  })

  test("Amp uses timestamped usage from actor snapshots", async () => {
    const home = await mkdtemp(join(tmpdir(), "stats-amp-actor-"))
    const data = join(home, "data")
    const path = join(data, "amp", "threads", "T-actor.json")
    await json(path, { id: "T-actor", created: 1767225600000, env: { initial: { workspaceRoot: "/work/app/" } }, messages: [{ messageId: "M-one", role: "assistant", createdAt: "2026-01-02T00:00:02Z", usage: { timestamp: "2026-01-02T00:00:01Z", model: "gpt-5", inputTokens: 7, outputTokens: 3 } }] })
    const source = await first(ampAdapter, home, { XDG_DATA_HOME: data })
    expect((await ampAdapter.parse(source, parseContext())).events[0]).toMatchObject({ sessionId: "T-actor", project: resolve("/work/app"), timestamp: 1767312001000, model: "gpt-5", tokens: { input: 7, output: 3 } })
  })

  test("Droid maps settings totals and project sidecar directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "stats-droid-"))
    const path = join(home, ".factory", "sessions", "my-project", "s.settings.json")
    await json(path, { model: "claude-sonnet", providerLock: "anthropic", providerLockTimestamp: "2026-01-02T00:00:00Z", tokenUsage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2, cacheCreationTokens: 3, thinkingTokens: 1 } })
    const source = await first(droidAdapter, home)
    expect((await droidAdapter.parse(source, parseContext())).events[0]).toMatchObject({ project: "my-project", tokens: { input: 10, output: 4, cacheRead: 2, cacheWrite: 3, reasoning: 1 } })
  })

  test("Droid reduces custom BYOK labels to catalog model ids", async () => {
    const home = await mkdtemp(join(tmpdir(), "stats-droid-custom-"))
    const settings = { providerLock: "openai", providerLockTimestamp: "2026-01-02T00:00:00Z", tokenUsage: { inputTokens: 1 } }
    await json(join(home, ".factory", "sessions", "p", "a.settings.json"), { ...settings, model: "custom:Codex:-GPT-5.4-(high)-5" })
    await json(join(home, ".factory", "sessions", "p", "b.settings.json"), { ...settings, model: "custom:Claude-Code:-Opus-4.6-(High)-0" })
    const context: DiscoveryContext = { platform: "darwin", home, env: {}, extraRoots: [] }
    const models = []
    for await (const source of droidAdapter.discover(context)) {
      models.push((await droidAdapter.parse(source, parseContext())).events[0]?.model)
    }
    expect(models.sort()).toEqual(["claude-opus-4-6", "gpt-5.4"])
  })
})
