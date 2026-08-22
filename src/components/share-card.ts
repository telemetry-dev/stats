import type {
  BreakdownRow,
  OverviewStats,
  StatsFilter,
  TimeRange,
  TimeSeries,
} from "@/lib/api/types"
import {
  formatCount,
  formatShare,
  formatTokens,
} from "@/components/data/format"

import interFontUrl from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url"
import monoFontUrl from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url"

const CARD_WIDTH = 1200
const CARD_HEIGHT = 675
/** 1x rasters look soft on retina displays and in X previews. */
const RASTER_SCALE = 2
const MAX_CHART_POINTS = 48

// The dashboard's light theme (src/styles.css :root) resolved to sRGB, since
// the SVG renders outside the app's CSS variable context.
const INK = "#0a0a0a" // --foreground
const MUTED_FG = "#666666" // --muted-foreground
const MUTED = "#f2f2f2" // --muted
const TILE = "#f8f8f8" // bg-muted/50 over white
const CHART_COLORS = ["#0078ee", "#8556ed", "#de54a1", "#04b0a1"] // --chart-1..4
const OTHER_COLOR = "#b3b3b3"
const CHIP_COLORS = {
  lime: { fill: "#e6f8f2", text: "#007a55" },
  rose: { fill: "#ffeaeb", text: "#c10007" },
  neutral: { fill: MUTED, text: MUTED_FG },
} as const

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
})

const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
})

const PERIODS: Record<TimeRange, { label: string; caption: string }> = {
  "24h": { label: "Last 24 hours", caption: "the last 24 hours" },
  "7d": { label: "Last 7 days", caption: "the last 7 days" },
  "30d": { label: "Last 30 days", caption: "the last 30 days" },
  "90d": { label: "Last 90 days", caption: "the last 90 days" },
  year: { label: "Last year", caption: "the last year" },
  all: { label: "All time", caption: "my all-time view" },
}

export type UsageShareScope = { kind: "all" } | { kind: "filtered" }

export type UsageShareComparison =
  { kind: "percent"; value: number } | { kind: "unavailable" }

export interface UsageShareModel {
  label: string
  share: number
}

export interface UsageShareSnapshot {
  period: {
    label: string
    caption: string
    startLabel: string
    endLabel: string
  }
  scope: UsageShareScope
  totalTokens: number
  comparison: UsageShareComparison
  /** Token series downsampled to at most MAX_CHART_POINTS values. */
  tokenBins: readonly number[]
  models: readonly UsageShareModel[]
  stats: {
    sessions: number
    activeDays: number
    pricedCostUsd: number
    outputTokens: number
  }
}

export interface UsageShareSource {
  overview: OverviewStats
  series: TimeSeries
  models: readonly BreakdownRow[]
  filter: StatsFilter
}

export interface UsageShareAsset {
  file: File
  svg: string
  caption: string
  xIntentUrl: string
  altText: string
}

export function createUsageShareSnapshot(
  source: UsageShareSource
): UsageShareSnapshot {
  const { overview, series, models, filter } = source
  const period =
    filter.from || filter.to
      ? { label: "Selected range", caption: "the selected range" }
      : PERIODS[filter.range]
  const previousTokens = overview.previous?.tokens.total
  const change =
    previousTokens !== undefined && previousTokens > 0
      ? ((overview.tokens.total - previousTokens) / previousTokens) * 100
      : null
  const comparison: UsageShareComparison =
    change !== null && Number.isFinite(change)
      ? { kind: "percent", value: change }
      : { kind: "unavailable" }
  const first = overview.firstTimestamp ?? series.points.at(0)?.t ?? null
  const last = overview.lastTimestamp ?? series.points.at(-1)?.t ?? null
  return {
    period: {
      ...period,
      startLabel: first === null ? "No data" : dayFormat.format(first),
      endLabel: last === null ? "No data" : dayFormat.format(last),
    },
    scope:
      filter.from ||
      filter.to ||
      filter.agents?.length ||
      filter.models?.length ||
      filter.projects?.length
        ? { kind: "filtered" }
        : { kind: "all" },
    totalTokens: overview.tokens.total,
    comparison,
    tokenBins: makeTokenBins(series),
    models: makeModelMix(models),
    stats: {
      sessions: overview.sessions,
      activeDays: overview.activeDays,
      pricedCostUsd: overview.pricedCostUsd,
      outputTokens: overview.tokens.output,
    },
  }
}

export function createUsageShareCaption(snapshot: UsageShareSnapshot): string {
  return `${formatTokens(snapshot.totalTokens)} tokens across my local AI coding agents in ${snapshot.period.caption}.\n\nTrack yours: npx @telemetry-dev/stats`
}

export function createUsageShareAlt(snapshot: UsageShareSnapshot): string {
  const modelSummary = snapshot.models
    .filter((model) => model.label !== "Other")
    .map((model) => `${model.label} ${formatShare(model.share)}`)
    .join(", ")
  const mix = modelSummary ? ` Model mix: ${modelSummary}.` : ""

  return `Telemetry Stats card showing ${formatTokens(snapshot.totalTokens)} total tokens in ${snapshot.period.caption}, ${formatCount(snapshot.stats.sessions)} sessions, and ${formatCount(snapshot.stats.activeDays)} active days.${mix}`
}

export async function createUsageShareAsset(
  source: UsageShareSource
): Promise<UsageShareAsset> {
  const snapshot = createUsageShareSnapshot(source)
  const svg = renderUsageShareSvg(snapshot, await loadFontStyle())
  const caption = createUsageShareCaption(snapshot)
  const file = await renderPng(svg)

  return {
    file,
    svg,
    caption,
    altText: createUsageShareAlt(snapshot),
    xIntentUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}`,
  }
}

/**
 * 1200x675 card mirroring the overview page: header chrome, a hero chart tile
 * (label, headline value, delta chip, area line), a 2x2 stat tile grid, a
 * model mix tile, and the install command as a filter-chip style pill.
 */
export function renderUsageShareSvg(
  snapshot: UsageShareSnapshot,
  fontStyle = ""
): string {
  const period = escapeXml(snapshot.period.label)
  const periodHeader =
    snapshot.scope.kind === "filtered"
      ? `<text x="1060" y="53" class="sans" fill="${MUTED_FG}" font-size="17" text-anchor="end">${period}</text>
    <rect x="1076" y="34" width="76" height="28" rx="6" fill="${MUTED}"/>
    <text x="1114" y="53" class="sans" fill="${MUTED_FG}" font-size="15" font-weight="500" text-anchor="middle">Filtered</text>`
      : `<text x="1152" y="53" class="sans" fill="${MUTED_FG}" font-size="17" text-anchor="end">${period}</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-labelledby="title description">
  <title id="title">Telemetry Stats usage card</title>
  <desc id="description">${escapeXml(createUsageShareAlt(snapshot))}</desc>
  <defs>
    <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${CHART_COLORS[0]}" stop-opacity=".32"/>
      <stop offset="100%" stop-color="${CHART_COLORS[0]}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="frame-clip">
      <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="24"/>
    </clipPath>
    <clipPath id="mix-clip">
      <rect x="748" y="446" width="376" height="8" rx="4"/>
    </clipPath>
    <style>
      ${fontStyle}
      .sans { font-family: "Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .mono { font-family: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace; }
      .num { font-variant-numeric: tabular-nums; }
    </style>
  </defs>
  <g clip-path="url(#frame-clip)">
    <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#ffffff"/>
    ${LOGO}
    <text x="94" y="57" class="sans" fill="${INK}" font-size="22" font-weight="600">Telemetry Stats</text>
    ${periodHeader}
    <line x1="0" y1="92" x2="1200" y2="92" stroke="${INK}" stroke-opacity=".09"/>

    <rect x="48" y="124" width="664" height="461" rx="16" fill="${TILE}"/>
    <text x="76" y="180" class="sans" fill="${MUTED_FG}" font-size="17">Total tokens</text>
    ${renderDeltaChip(snapshot.comparison)}
    <text x="74" y="262" class="sans num" fill="${INK}" font-size="84" font-weight="650" letter-spacing="-.025em">${escapeXml(formatTokens(snapshot.totalTokens))}</text>
    ${renderChart(snapshot.tokenBins)}
    <text x="76" y="546" class="sans" fill="${MUTED_FG}" font-size="14" font-weight="500">${escapeXml(snapshot.period.startLabel)}</text>
    <text x="684" y="546" class="sans" fill="${MUTED_FG}" font-size="14" font-weight="500" text-anchor="end">${escapeXml(snapshot.period.endLabel)}</text>

    ${renderStatTiles(snapshot)}
    ${renderModelMix(snapshot.models)}

    <rect x="48" y="607" width="314" height="40" rx="8" fill="${TILE}" stroke="${INK}" stroke-opacity=".09"/>
    <text x="64" y="633" class="mono" font-size="18"><tspan fill="${MUTED_FG}">$ </tspan><tspan fill="${INK}" font-weight="500">npx @telemetry-dev/stats</tspan></text>
    <text x="1152" y="633" class="mono" fill="${MUTED_FG}" font-size="15" text-anchor="end">telemetry.dev</text>
  </g>
  <rect x=".5" y=".5" width="${CARD_WIDTH - 1}" height="${CARD_HEIGHT - 1}" rx="23.5" fill="none" stroke="${INK}" stroke-opacity=".09"/>
</svg>`
}

function makeTokenBins(series: TimeSeries): readonly number[] {
  const points = series.points
  if (points.length === 0) return []

  const count = Math.min(MAX_CHART_POINTS, points.length)
  const bins = Array.from({ length: count }, () => 0)
  for (let index = 0; index < points.length; index++) {
    const bin = Math.min(count - 1, Math.floor((index * count) / points.length))
    bins[bin] += points[index].tokens
  }
  return bins
}

function makeModelMix(
  rows: readonly BreakdownRow[]
): readonly UsageShareModel[] {
  const ranked = rows
    .filter((row) => row.tokens.total > 0)
    .sort((a, b) => b.tokens.total - a.tokens.total)
  const total = ranked.reduce((sum, row) => sum + row.tokens.total, 0)
  if (total === 0) return []

  const top = ranked.slice(0, 3).map((row) => ({
    label: row.label,
    share: row.tokens.total / total,
  }))
  const shown = top.reduce((sum, model) => sum + model.share, 0)
  const other = Math.max(0, 1 - shown)

  return ranked.length > 3 ? [...top, { label: "Other", share: other }] : top
}

/** Delta chip in the hero tile's top-right corner, like the StatTile chips. */
function renderDeltaChip(comparison: UsageShareComparison): string {
  if (comparison.kind === "unavailable") return ""

  const rounded = Math.round(comparison.value * 10) / 10
  const label =
    rounded === 0 ? "0.0%" : `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`
  const color =
    rounded === 0
      ? CHIP_COLORS.neutral
      : rounded > 0
        ? CHIP_COLORS.lime
        : CHIP_COLORS.rose
  const width = Math.round(label.length * 8.6) + 22

  return `<rect x="${684 - width}" y="152" width="${width}" height="28" rx="6" fill="${color.fill}"/>
    <text x="${684 - width / 2}" y="171" class="sans num" fill="${color.text}" font-size="15" font-weight="600" text-anchor="middle">${escapeXml(label)}</text>`
}

/**
 * Area line matching UsageChartCard: chart-1 stroke over a fading fill with
 * sharp linear joins. An empty or all-zero series draws the dashed grey
 * baseline the dashboard uses for zero runs.
 */
function renderChart(bins: readonly number[]): string {
  const left = 76
  const right = 684
  const top = 300
  const bottom = 508
  const max = Math.max(0, ...bins)

  if (max === 0) {
    return `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${MUTED_FG}" stroke-opacity=".6" stroke-width="2.5" stroke-dasharray="6 6"/>`
  }

  const values = bins.length === 1 ? [bins[0], bins[0]] : bins
  const step = (right - left) / (values.length - 1)
  const coords = values.map((value, index) => {
    const x = (left + index * step).toFixed(1)
    const y = (bottom - (value / max) * (bottom - top)).toFixed(1)
    return `${x} ${y}`
  })
  const line = `M${coords.join(" L")}`

  return `<path d="${line} L${right} ${bottom} L${left} ${bottom} Z" fill="url(#area-fill)"/>
    <path d="${line}" fill="none" stroke="${CHART_COLORS[0]}" stroke-width="3" stroke-linecap="round"/>`
}

/** 2x2 grid of Panel-style tiles: small muted label over a big tabular value. */
function renderStatTiles(snapshot: UsageShareSnapshot): string {
  const tiles = [
    { label: "Sessions", value: formatCount(snapshot.stats.sessions) },
    { label: "Active days", value: formatCount(snapshot.stats.activeDays) },
    {
      label: "Priced cost",
      value: compactUsd.format(snapshot.stats.pricedCostUsd),
    },
    {
      label: "Output tokens",
      value: formatTokens(snapshot.stats.outputTokens),
    },
  ]

  return tiles
    .map((tile, index) => {
      const x = index % 2 === 0 ? 728 : 948
      const y = index < 2 ? 124 : 260
      return `<rect x="${x}" y="${y}" width="204" height="120" rx="16" fill="${TILE}"/>
    <text x="${x + 20}" y="${y + 38}" class="sans" fill="${MUTED_FG}" font-size="15">${tile.label}</text>
    <text x="${x + 20}" y="${y + 96}" class="sans num" fill="${INK}" font-size="30" font-weight="650" letter-spacing="-.01em">${escapeXml(tile.value)}</text>`
    })
    .join("\n    ")
}

/** Model mix tile: stacked share bar plus a legend, like the token mix panel. */
function renderModelMix(models: readonly UsageShareModel[]): string {
  const tile = `<rect x="728" y="396" width="424" height="189" rx="16" fill="${TILE}"/>
    <text x="748" y="434" class="sans" fill="${MUTED_FG}" font-size="15">Model mix</text>`

  if (models.length === 0) {
    return `${tile}
    <text x="748" y="500" class="sans" fill="${MUTED_FG}" font-size="15">No model data</text>`
  }

  const shown = models.slice(0, 4)
  const colors = shown.map((model, index) =>
    model.label === "Other" ? OTHER_COLOR : CHART_COLORS[index]
  )

  let cursor = 748
  const segments = shown
    .map((model, index) => {
      const width = Math.max(4, model.share * 376 - 2)
      const x = cursor
      cursor += width + 2
      return `<rect x="${x.toFixed(1)}" y="446" width="${width.toFixed(1)}" height="8" fill="${colors[index]}"/>`
    })
    .join("")

  const legend = shown
    .map((model, index) => {
      const baseline = 484 + index * 26
      const percent = model.share * 100
      const share =
        percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`
      return `<rect x="748" y="${baseline - 11}" width="12" height="12" rx="3" fill="${colors[index]}"/>
    <text x="770" y="${baseline}" class="sans" fill="${INK}" font-size="15" font-weight="500">${escapeXml(clipModelLabel(model.label))}</text>
    <text x="1124" y="${baseline}" class="sans num" fill="${INK}" font-size="15" font-weight="600" text-anchor="end">${escapeXml(share)}</text>`
    })
    .join("\n    ")

  return `${tile}
    <g clip-path="url(#mix-clip)"><rect x="748" y="446" width="376" height="8" fill="#e8e8e8"/>${segments}</g>
    ${legend}`
}

const LOGO = `<g transform="translate(48 34) scale(.30)" fill="${INK}" aria-hidden="true">
      <path d="M28.3 17.8C26.8 17.8 26.1 15.9 27.4 14.9C34.3 10.6 43.7 5.8 57.3 5.8C70.9 5.8 80.3 10.6 87.2 14.9C88.5 15.9 87.8 17.8 86.3 17.8Z"/>
      <path d="M19.8 22.9H94.8Q96.3 22.9 97.04 24.2Q100.1 27.95 101.76 32.5Q102.5 33.8 101 33.8H77.3C71.3 33.8 68.6 32 65.8 31C63 30 61.4 29.2 57.3 29.2C53.2 29.2 51.6 30 48.8 31C46 32 43.3 33.8 37.3 33.8H13.6Q12.1 33.8 12.84 32.5Q14.5 27.95 17.56 24.2Q18.3 22.9 19.8 22.9Z"/>
      <path d="M34.2 38.8C35.6 38.8 36.3 40.3 35.6 41.4C34.7 42.6 33.4 45.4 32.9 46.9C32.4 48.3 30.8 49.3 29.9 49.3H7.8C7 49.3 6.3 48.5 6.4 47.2C6.7 45.2 7.4 42.1 8.1 40C8.4 39.35 9.1 38.8 9.55 38.8Z"/>
      <path d="M80.4 38.8H105.05C105.75 38.8 106.2 39.35 106.5 40C107.2 42.1 107.9 45.2 108.2 47.2C108.3 48.5 107.6 49.3 106.8 49.3H84.7C83.8 49.3 82.2 48.3 81.7 46.9C81.2 45.4 79.9 42.6 79 41.4C78.3 40.3 79 38.8 80.4 38.8Z"/>
      <path d="M6.8 54.5H107.8Q109.3 54.5 109.3 56L109.3 61.9Q109.3 63.4 107.8 63.4H6.8Q5.3 63.4 5.3 61.9L5.3 56Q5.3 54.5 6.8 54.5Z"/>
      <path d="M8.3 68.3H106.3C107.5 68.3 107.97 69.36 107.6 70.5L106.25 74.7C105.88 75.84 106.25 76.1 105.05 76.1H9.55C8.35 76.1 8.72 75.84 8.35 74.7L7 70.5C6.63 69.36 7.1 68.3 8.3 68.3Z"/>
      <path d="M14 81.5H100.6C101.8 81.5 102.56 83.35 101.9 84.35L99.55 87.9C98.89 88.9 99.65 88.7 98.45 88.7H16.15C14.95 88.7 15.71 88.9 15.05 87.9L12.7 84.35C12.04 83.35 12.8 81.5 14 81.5Z"/>
      <path d="M24.2 93.5H90.4C91.6 93.5 92.27 95.83 91.35 96.6L88.7 98.8C87.78 99.57 88.9 99.3 87.7 99.3H26.9C25.7 99.3 26.82 99.57 25.9 98.8L23.25 96.6C22.33 95.83 23 93.5 24.2 93.5Z"/>
      <path d="M45.6 104.5H69C70.7 104.5 71.2 107.2 69.3 107.5C66 108.3 61.9 108.9 57.3 108.9C52.7 108.9 48.6 108.3 45.3 107.5C43.4 107.2 43.9 104.5 45.6 104.5Z"/>
    </g>`

function clipModelLabel(label: string): string {
  const limit = 28
  if (label.length <= limit) return label
  const side = Math.floor((limit - 1) / 2)
  return `${label.slice(0, side)}…${label.slice(-side)}`
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

let fontStylePromise: Promise<string> | null = null

/**
 * @font-face rules with the app's fonts inlined as data URIs. SVGs inside an
 * <img> can't reach document fonts, so without this the preview and PNG fall
 * back to system fonts. Cached after the first load; a failed load falls back
 * to the system stack and retries on the next call.
 */
function loadFontStyle(): Promise<string> {
  fontStylePromise ??= Promise.all([
    fetchFontData(interFontUrl),
    fetchFontData(monoFontUrl),
  ]).then(
    ([inter, mono]) =>
      `@font-face { font-family: "Inter Variable"; font-style: normal; font-weight: 100 900; src: url(${inter}) format("woff2"); }
      @font-face { font-family: "JetBrains Mono Variable"; font-style: normal; font-weight: 100 800; src: url(${mono}) format("woff2"); }`,
    () => {
      fontStylePromise = null
      return ""
    }
  )
  return fontStylePromise
}

async function fetchFontData(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load font: ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return `data:font/woff2;base64,${btoa(binary)}`
}

async function renderPng(svg: string): Promise<File> {
  // Scaling the root width/height (viewBox unchanged) forces every engine to
  // rasterize the vector at the full output resolution.
  const scaled = svg.replace(
    `width="${CARD_WIDTH}" height="${CARD_HEIGHT}"`,
    `width="${CARD_WIDTH * RASTER_SCALE}" height="${CARD_HEIGHT * RASTER_SCALE}"`
  )
  const url = URL.createObjectURL(
    new Blob([scaled], { type: "image/svg+xml;charset=utf-8" })
  )

  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error("Could not load the share image."))
      image.src = url
    })

    const canvas = document.createElement("canvas")
    canvas.width = CARD_WIDTH * RASTER_SCALE
    canvas.height = CARD_HEIGHT * RASTER_SCALE
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Could not create the share image.")
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result)
        else reject(new Error("Could not create the share image."))
      }, "image/png")
    })

    return new File([blob], "telemetry-stats.png", { type: "image/png" })
  } finally {
    URL.revokeObjectURL(url)
  }
}
