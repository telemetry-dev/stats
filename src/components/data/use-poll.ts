import * as React from "react"

export interface PollState<T> {
  data: T | null
  error: string | null
  loading: boolean
  updatedAt: number | null
  refresh: () => void
}

const refreshListeners = new Set<() => void>()

/**
 * Refetches every mounted poll in place, without a loading flip. Lets the
 * sync control push fresh data to the pages as soon as a sync completes,
 * instead of them waiting out their poll interval.
 */
export function refreshPolls() {
  for (const listener of refreshListeners) listener()
}

/**
 * Fetches on mount and every `intervalMs` (default 30s), refetching whenever
 * `key` changes. Stale responses from superseded requests are dropped.
 */
export function usePoll<T>(
  load: () => Promise<T>,
  key: string,
  intervalMs = 30_000
): PollState<T> {
  const [data, setData] = React.useState<T | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null)
  const [tick, setTick] = React.useState(0)
  const loadRef = React.useRef(load)
  loadRef.current = load

  React.useEffect(() => {
    let alive = true
    let generation = 0

    const run = async (initial: boolean) => {
      const id = ++generation
      if (initial) setLoading(true)
      try {
        const next = await loadRef.current()
        if (!alive || id !== generation) return
        setData(next)
        setError(null)
        setUpdatedAt(Date.now())
      } catch (cause) {
        if (!alive || id !== generation) return
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (alive && id === generation) setLoading(false)
      }
    }

    void run(true)
    const timer = setInterval(() => void run(false), intervalMs)
    const listener = () => void run(false)
    refreshListeners.add(listener)
    return () => {
      alive = false
      clearInterval(timer)
      refreshListeners.delete(listener)
    }
  }, [key, tick, intervalMs])

  const refresh = React.useCallback(() => setTick((n) => n + 1), [])

  return { data, error, loading, updatedAt, refresh }
}
