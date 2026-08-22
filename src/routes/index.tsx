import { createFileRoute, Link } from "@tanstack/react-router"
import {
  RiCoinsLine,
  RiDatabase2Line,
  RiExportLine,
  RiMoneyDollarCircleLine,
  RiTerminalBoxLine,
  RiTimeLine,
} from "@remixicon/react"

import { AGENTS } from "@/lib/agents/registry"
import type {
  BreakdownRow,
  OverviewStats,
  SessionPage,
  StatsFilter,
  TimeSeries,
} from "@/lib/api/types"
import { getJson, parseStatsSearch, statsUrl } from "@/components/data/api"
import {
  formatCost,
  formatCount,
  formatDuration,
  formatRelative,
  formatShare,
  formatTokens,
} from "@/components/data/format"
import { usePoll } from "@/components/data/use-poll"
import {
  ActivityCalendar,
  TokenMixBar,
  UsageChartCard,
} from "@/components/charts"
import { EmptyState, ErrorState, PageSkeleton } from "@/components/states"

export const Route = createFileRoute("/")({
  validateSearch: parseStatsSearch,
  component: OverviewPage,
})

interface OverviewData {
  overview: OverviewStats
  series: TimeSeries
  yearSeries: TimeSeries
  agents: BreakdownRow[]
  models: BreakdownRow[]
  sessions: SessionPage
}

function OverviewPage() {
  const filter = Route.useSearch()
  const poll = usePoll<OverviewData>(async () => {
    const yearFilter: StatsFilter = { range: "year", agents: filter.agents }
    const [overview, series, yearSeries, agents, models, sessions] =
      await Promise.all([
        getJson<OverviewStats>(statsUrl("overview", filter)),
        getJson<TimeSeries>(statsUrl("timeseries", filter)),
        getJson<TimeSeries>(statsUrl("timeseries", yearFilter)),
        getJson<BreakdownRow[]>(
          statsUrl("breakdown", filter, { dimension: "agent" })
        ),
        getJson<BreakdownRow[]>(
          statsUrl("breakdown", filter, { dimension: "model" })
        ),
        getJson<SessionPage>(
          statsUrl("sessions", filter, { page: "1", pageSize: "5" })
        ),
      ])
    return { overview, series, yearSeries, agents, models, sessions }
  }, JSON.stringify(filter))

  if (poll.error)
    return <ErrorState message={poll.error} onRetry={poll.refresh} />
  // Keep rendering stale data during refetches; swapping to the skeleton on
  // every range/filter change makes the whole page flash.
  if (!poll.data) return <PageSkeleton />

  const { overview, series, yearSeries, agents, models, sessions } = poll.data
  const filtered = (filter.agents?.length ?? 0) > 0 || filter.range !== "all"
  if (overview.events === 0) return <EmptyState filtered={filtered} />

  const estimated = overview.hasEstimatedTokens
  const prev = overview.previous

  return (
    <div className="flex flex-col">
      <h1 className="sr-only">Overview</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          icon={RiCoinsLine}
          label="Total tokens"
          value={formatTokens(overview.tokens.total)}
          delta={deltaOf(overview.tokens.total, prev?.tokens.total)}
          chip={estimated ? "includes est." : undefined}
        />
        <StatTile
          icon={RiMoneyDollarCircleLine}
          label="Priced cost"
          value={formatCost(overview.pricedCostUsd)}
          delta={deltaOf(overview.pricedCostUsd, prev?.pricedCostUsd)}
          chip={
            overview.unpricedEventCount > 0
              ? `+${formatCount(overview.unpricedEventCount)} unpriced`
              : undefined
          }
        />
        <StatTile
          icon={RiTerminalBoxLine}
          label="Sessions"
          value={formatCount(overview.sessions)}
          delta={deltaOf(overview.sessions, prev?.sessions)}
        />
        <StatTile
          icon={RiTimeLine}
          label="Active time"
          value={formatDuration(overview.activeTimeMs)}
          delta={deltaOf(overview.activeTimeMs, prev?.activeTimeMs)}
          chip={`${formatCount(overview.activeDays)} days`}
        />
        <StatTile
          icon={RiDatabase2Line}
          label="Cache read share"
          value={formatShare(overview.cacheReadShare)}
          delta={deltaOf(overview.cacheReadShare, prev?.cacheReadShare)}
        />
        <StatTile
          icon={RiExportLine}
          label="Output tokens"
          value={formatTokens(overview.tokens.output)}
          delta={deltaOf(overview.tokens.output, prev?.tokens.output)}
        />
      </div>

      <UsageChartCard
        className="mt-8"
        series={series}
        total={overview.tokens.total}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          label="Activity"
          value={`${formatCount(overview.activeDays)} active days`}
          description="Tokens per day, last year"
        >
          <ActivityCalendar series={yearSeries} />
        </Panel>
        <Panel
          label="Token mix"
          value={formatTokens(overview.tokens.total)}
          description={`Input, output, cache, and reasoning tokens${estimated ? " (some values estimated)" : ""}`}
        >
          <TokenMixBar tokens={overview.tokens} />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <TopList
          label="Agents"
          unit="agents"
          rows={agents}
          to="/agents"
          filter={filter}
        />
        <TopList
          label="Models"
          unit="models"
          rows={models}
          to="/models"
          filter={filter}
        />
      </div>

      <Panel
        className="mt-4"
        label="Sessions"
        value={`${formatCount(sessions.total)} sessions`}
        action={
          <Link
            to="/sessions"
            search={{ ...filter, page: 1, pageSize: 25 }}
            className="text-[13px] text-muted-foreground hover:text-foreground"
          >
            View all →
          </Link>
        }
      >
        <ul className="flex flex-col">
          {sessions.sessions.map((session) => (
            <li
              key={`${session.agent}:${session.sessionId}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b py-2.5 text-sm last:border-b-0 last:pb-0"
            >
              <span className="font-medium">{AGENTS[session.agent].label}</span>
              <span className="truncate text-muted-foreground">
                {session.project ?? "no project"}
              </span>
              <span className="ms-auto font-mono text-[13px] tabular-nums">
                {formatTokens(session.tokens.total)}
              </span>
              <span className="w-16 text-right font-mono text-[13px] text-muted-foreground tabular-nums">
                {formatRelative(session.lastTimestamp)}
              </span>
            </li>
          ))}
          {sessions.sessions.length === 0 ? (
            <li className="py-2 text-sm text-muted-foreground">
              No sessions in range
            </li>
          ) : null}
        </ul>
      </Panel>
    </div>
  )
}

/** Change vs the previous period as a chip: "+14.8%" lime, "-3.2%" rose, "0.0%" neutral. */
function deltaOf(
  current: number,
  previous: number | undefined
): { label: string; color: ChipColor } | undefined {
  if (previous === undefined || previous <= 0) return undefined
  const pct = ((current - previous) / previous) * 100
  if (!Number.isFinite(pct)) return undefined
  const rounded = Math.round(pct * 10) / 10
  if (rounded === 0) return { label: "0.0%", color: "neutral" }
  return {
    label: `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`,
    color: rounded > 0 ? "lime" : "rose",
  }
}

/**
 * KPI tile: icon in a bordered chip top-left, delta Chip top-right, label
 * over a big tabular value with an optional note Chip beside it.
 */
function StatTile({
  icon: Icon,
  label,
  value,
  delta,
  chip,
}: {
  icon: React.ComponentType<{
    className?: string
    "aria-hidden"?: boolean | "true" | "false"
  }>
  label: string
  value: string
  delta?: { label: string; color: ChipColor }
  chip?: string
}) {
  return (
    <section className="flex h-[132px] min-w-0 flex-col items-start justify-between rounded-2xl bg-muted/50 p-4">
      <div className="flex w-full items-start justify-between gap-2">
        <span className="flex items-center rounded-md border bg-background p-1.5 shadow-xs dark:bg-muted">
          <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        </span>
        {delta ? <Chip color={delta.color}>{delta.label}</Chip> : null}
      </div>
      <div className="flex w-full flex-col gap-0.5">
        <p className="w-full truncate text-[13px] text-muted-foreground">
          {label}
        </p>
        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-2xl font-semibold tracking-tight whitespace-nowrap tabular-nums">
            {value}
          </p>
          {chip ? <Chip>{chip}</Chip> : null}
        </div>
      </div>
    </section>
  )
}

type ChipColor = "lime" | "rose" | "neutral"

const CHIP_COLORS: Record<ChipColor, string> = {
  lime: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  rose: "bg-red-500/10 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  neutral: "bg-muted text-muted-foreground",
}

/** Tinted label pill next to a headline value. */
function Chip({
  color = "neutral",
  children,
}: {
  color?: ChipColor
  children: React.ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${CHIP_COLORS[color]}`}
    >
      {children}
    </span>
  )
}

/** Rounded stat card: small muted label, big value, optional description/action. */
function Panel({
  label,
  value,
  description,
  action,
  className,
  children,
}: {
  label: string
  value?: string
  description?: string
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      className={`min-w-0 rounded-2xl bg-muted/50 p-5 ${className ?? ""}`}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-[13px] text-muted-foreground">{label}</p>
          {value ? (
            <p className="text-xl font-semibold tracking-tight tabular-nums">
              {value}
            </p>
          ) : null}
          {description ? (
            <p className="text-[13px] text-pretty text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ?? null}
      </div>
      {children}
    </section>
  )
}

function TopList({
  label,
  unit,
  rows,
  to,
  filter,
}: {
  label: string
  unit: string
  rows: BreakdownRow[]
  to: "/agents" | "/models"
  filter: StatsFilter
}) {
  const top = rows
    .slice()
    .sort((a, b) => b.tokens.total - a.tokens.total)
    .slice(0, 5)
  return (
    <Panel
      label={label}
      value={`${formatCount(rows.length)} ${unit}`}
      action={
        <Link
          to={to}
          search={filter}
          className="text-[13px] text-muted-foreground hover:text-foreground"
        >
          View all →
        </Link>
      }
    >
      <ul className="flex flex-col gap-3">
        {top.map((row) => (
          <li key={row.key} className="flex items-center gap-3 text-sm">
            <span className="w-28 truncate sm:w-40" title={row.label}>
              {row.label}
            </span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-chart-1"
                style={{ width: `${Math.max(row.tokenShare * 100, 1)}%` }}
              />
            </div>
            <span className="w-16 text-right font-mono text-[13px] tabular-nums">
              {formatTokens(row.tokens.total)}
            </span>
          </li>
        ))}
        {top.length === 0 ? (
          <li className="text-sm text-muted-foreground">No data in range</li>
        ) : null}
      </ul>
    </Panel>
  )
}
