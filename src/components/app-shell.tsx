import * as React from "react"
import {
  Link,
  useMatchRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router"
import {
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  MoonIcon,
  RefreshCwIcon,
  SunIcon,
  XIcon,
} from "lucide-react"

import { AGENTS, AGENT_IDS } from "@/lib/agents/registry"
import type { AgentId } from "@/lib/agents/registry"
import type { StatsFilter, SyncStatus, TimeRange } from "@/lib/api/types"
import { TIME_RANGES } from "@/lib/api/types"
import { getJson } from "@/components/data/api"
import { refreshPolls, usePoll } from "@/components/data/use-poll"
import { formatRelative } from "@/components/data/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { UsageShareSheet } from "@/components/share-usage"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/activity", label: "Activity" },
  { to: "/agents", label: "Agents" },
  { to: "/models", label: "Models" },
  { to: "/projects", label: "Projects" },
  { to: "/sessions", label: "Sessions" },
  { to: "/settings", label: "Settings" },
] as const

const RANGE_LABELS: Record<TimeRange, string> = {
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  year: "1y",
  all: "All",
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-16 md:px-6 md:pt-6">
        <Toolbar />
        {children}
      </main>
    </div>
  )
}

function useFilter(): StatsFilter {
  const search = useSearch({ strict: false })
  return {
    range: search.range ?? "30d",
    agents: search.agents,
    models: search.models,
    projects: search.projects,
    from: search.from,
    to: search.to,
  }
}

function AppHeader() {
  const filter = useFilter()
  return (
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
        <Link
          to="/"
          search={filter}
          className="flex items-center gap-2.5"
          aria-label="Telemetry Stats overview"
        >
          <svg
            viewBox="0 0 114.6 115"
            className="size-5"
            fill="currentColor"
            aria-hidden
          >
            <path d="M28.3 17.8C26.8 17.8 26.1 15.9 27.4 14.9C34.3 10.6 43.7 5.8 57.3 5.8C70.9 5.8 80.3 10.6 87.2 14.9C88.5 15.9 87.8 17.8 86.3 17.8Z" />
            <path d="M19.8 22.9H94.8Q96.3 22.9 97.04 24.2Q100.1 27.95 101.76 32.5Q102.5 33.8 101 33.8H77.3C71.3 33.8 68.6 32 65.8 31C63 30 61.4 29.2 57.3 29.2C53.2 29.2 51.6 30 48.8 31C46 32 43.3 33.8 37.3 33.8H13.6Q12.1 33.8 12.84 32.5Q14.5 27.95 17.56 24.2Q18.3 22.9 19.8 22.9Z" />
            <path d="M34.2 38.8C35.6 38.8 36.3 40.3 35.6 41.4C34.7 42.6 33.4 45.4 32.9 46.9C32.4 48.3 30.8 49.3 29.9 49.3H7.8C7 49.3 6.3 48.5 6.4 47.2C6.7 45.2 7.4 42.1 8.1 40C8.4 39.35 9.1 38.8 9.55 38.8Z" />
            <path d="M80.4 38.8H105.05C105.75 38.8 106.2 39.35 106.5 40C107.2 42.1 107.9 45.2 108.2 47.2C108.3 48.5 107.6 49.3 106.8 49.3H84.7C83.8 49.3 82.2 48.3 81.7 46.9C81.2 45.4 79.9 42.6 79 41.4C78.3 40.3 79 38.8 80.4 38.8Z" />
            <path d="M6.8 54.5H107.8Q109.3 54.5 109.3 56L109.3 61.9Q109.3 63.4 107.8 63.4H6.8Q5.3 63.4 5.3 61.9L5.3 56Q5.3 54.5 6.8 54.5Z" />
            <path d="M8.3 68.3H106.3C107.5 68.3 107.97 69.36 107.6 70.5L106.25 74.7C105.88 75.84 106.25 76.1 105.05 76.1H9.55C8.35 76.1 8.72 75.84 8.35 74.7L7 70.5C6.63 69.36 7.1 68.3 8.3 68.3Z" />
            <path d="M14 81.5H100.6C101.8 81.5 102.56 83.35 101.9 84.35L99.55 87.9C98.89 88.9 99.65 88.7 98.45 88.7H16.15C14.95 88.7 15.71 88.9 15.05 87.9L12.7 84.35C12.04 83.35 12.8 81.5 14 81.5Z" />
            <path d="M24.2 93.5H90.4C91.6 93.5 92.27 95.83 91.35 96.6L88.7 98.8C87.78 99.57 88.9 99.3 87.7 99.3H26.9C25.7 99.3 26.82 99.57 25.9 98.8L23.25 96.6C22.33 95.83 23 93.5 24.2 93.5Z" />
            <path d="M45.6 104.5H69C70.7 104.5 71.2 107.2 69.3 107.5C66 108.3 61.9 108.9 57.3 108.9C52.7 108.9 48.6 108.3 45.3 107.5C43.4 107.2 43.9 104.5 45.6 104.5Z" />
          </svg>
          <span className="text-sm font-semibold tracking-tight">
            Telemetry Stats
          </span>
        </Link>
        <span
          className="text-sm text-muted-foreground max-sm:hidden"
          aria-hidden
        >
          /
        </span>
        <span className="font-mono text-xs text-muted-foreground max-sm:hidden">
          local
        </span>
        <div className="ms-auto flex items-center gap-1.5">
          <SyncControl />
          <GitHubLink />
          <ThemeToggle />
        </div>
      </div>
      <nav
        aria-label="Primary"
        className="mx-auto w-full max-w-6xl overflow-x-auto px-1 md:px-3"
      >
        <ul className="flex">
          {NAV.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                search={
                  item.to === "/sessions"
                    ? { ...filter, page: 1, pageSize: 25 }
                    : filter
                }
                activeProps={{ "data-active": true }}
                activeOptions={{ exact: item.to === "/" }}
                className="relative flex h-11 items-center px-3 text-sm whitespace-nowrap text-muted-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground after:opacity-0 hover:text-foreground data-active:text-foreground data-active:after:opacity-100"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  )
}

function Toolbar() {
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const filter = useFilter()
  const range = search.range ?? "30d"
  const agents = search.agents ?? []
  const models = search.models ?? []
  const projects = search.projects ?? []
  const setRange = (next: TimeRange) => {
    void navigate({
      to: ".",
      // Explicit range clears any from/to override.
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        range: next,
        from: undefined,
        to: undefined,
      }),
    })
  }

  const setAgents = (next: AgentId[]) => {
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        agents: next.length > 0 ? next : undefined,
      }),
    })
  }

  const removeFrom = (key: "models" | "projects", value: string) => {
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => {
        const rest = ((prev[key] as string[] | undefined) ?? []).filter(
          (item) => item !== value
        )
        return { ...prev, [key]: rest.length > 0 ? rest : undefined }
      },
    })
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <AgentFilter selected={agents} onChange={setAgents} />
        {models.map((model) => (
          <FilterChip
            key={model}
            label={model}
            onRemove={() => removeFrom("models", model)}
          />
        ))}
        {projects.map((project) => (
          <FilterChip
            key={project}
            label={project.split("/").pop() || project}
            onRemove={() => removeFrom("projects", project)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Date range"
          className="flex rounded-md border p-0.5"
        >
          {TIME_RANGES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
              className={`min-h-10 rounded-[calc(var(--radius)-2px)] px-2.5 text-[13px] tabular-nums focus-visible:ring-2 focus-visible:ring-ring md:min-h-7 ${
                range === value
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {RANGE_LABELS[value]}
            </button>
          ))}
        </div>
        {matchRoute({ to: "/" }) ? <UsageShareSheet filter={filter} /> : null}
      </div>
    </div>
  )
}

/** Active model/project filter, removable with ✕. */
function FilterChip({
  label,
  onRemove,
}: {
  label: string
  onRemove: () => void
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      title={`Remove filter ${label}`}
      className="flex min-h-10 items-center gap-1 rounded-md border bg-muted/50 px-2 text-[13px] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:min-h-7"
    >
      <span className="max-w-40 truncate">{label}</span>
      <XIcon className="size-3.5 text-muted-foreground" aria-hidden />
    </button>
  )
}

function AgentFilter({
  selected,
  onChange,
}: {
  selected: AgentId[]
  onChange: (agents: AgentId[]) => void
}) {
  const [query, setQuery] = React.useState("")
  const visible = AGENT_IDS.filter((id) =>
    AGENTS[id].label.toLowerCase().includes(query.toLowerCase())
  )

  const toggle = (id: AgentId) => {
    onChange(
      selected.includes(id)
        ? selected.filter((it) => it !== id)
        : [...selected, id]
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" className="min-h-11 text-[13px] md:min-h-8">
            {selected.length > 0 ? (
              <span>
                Agents{" "}
                <span className="text-muted-foreground tabular-nums">
                  · {selected.length}
                </span>
              </span>
            ) : (
              "All agents"
            )}
            <ChevronDownIcon className="text-muted-foreground" aria-hidden />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-64 p-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter agents…"
          aria-label="Filter agents"
          className="mb-2"
        />
        <div
          className="max-h-72 overflow-y-auto"
          role="listbox"
          aria-multiselectable="true"
        >
          {visible.map((id) => {
            const active = selected.includes(id)
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => toggle(id)}
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
              >
                <CheckIcon
                  className={active ? "size-4" : "size-4 opacity-0"}
                  aria-hidden
                />
                <span className="truncate">{AGENTS[id].label}</span>
              </button>
            )
          })}
          {visible.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No agents match
            </p>
          ) : null}
        </div>
        {selected.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full"
            onClick={() => onChange([])}
          >
            Clear selection
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function SyncControl() {
  // undefined = no status seen yet; null = seen, but no finished run.
  const lastFinished = React.useRef<number | null | undefined>(undefined)
  const poll = usePoll(
    async () => {
      const status = await getJson<SyncStatus>("/api/sync")
      const finishedAt = status.lastRun?.finishedAt ?? null
      // A new finishedAt means a sync completed (here, another tab, or the
      // CLI): push the new rows to the open page instead of waiting out the
      // 30s data poll.
      if (
        lastFinished.current !== undefined &&
        finishedAt !== null &&
        finishedAt !== lastFinished.current
      ) {
        refreshPolls()
      }
      lastFinished.current = finishedAt
      return status
    },
    "sync",
    5_000
  )
  const [starting, setStarting] = React.useState(false)
  const running = starting || (poll.data?.running ?? false)
  const finishedAt = poll.data?.lastRun?.finishedAt ?? null

  const start = async () => {
    setStarting(true)
    try {
      await getJson<SyncStatus>("/api/sync", { method: "POST" })
      poll.refresh()
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="flex items-center gap-2.5">
      {finishedAt !== null ? (
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
          synced {formatRelative(finishedAt)}
        </span>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        onClick={() => void start()}
        disabled={running}
        className="min-h-11 md:min-h-8"
      >
        {running ? (
          <Loader2Icon
            className="animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        ) : (
          <RefreshCwIcon aria-hidden />
        )}
        {running ? "Syncing…" : "Sync"}
      </Button>
    </div>
  )
}

function ThemeToggle() {
  const toggle = () => {
    const dark = document.documentElement.classList.toggle("dark")
    localStorage.setItem("theme", dark ? "dark" : "light")
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="min-h-11 min-w-11 md:min-h-8 md:min-w-8"
    >
      <SunIcon className="dark:hidden" aria-hidden />
      <MoonIcon className="hidden dark:block" aria-hidden />
    </Button>
  )
}

function GitHubLink() {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="GitHub repository"
      className="min-h-11 min-w-11 md:min-h-8 md:min-w-8"
      nativeButton={false}
      render={
        <a
          href="https://github.com/telemetry-dev/stats"
          target="_blank"
          rel="noreferrer"
        />
      }
    >
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        fill="currentColor"
        aria-hidden
      >
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
    </Button>
  )
}
