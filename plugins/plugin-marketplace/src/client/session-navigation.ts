export interface SessionListSnapshot {
  current: string | undefined
  phase: 'pending' | 'ready'
}

export interface SessionNavigationState {
  current: string | undefined
  ready: boolean
}

export interface SessionNavigationTransition {
  close: boolean
  state: SessionNavigationState
}

/** Track user-visible session activation without treating startup as navigation. */
export function transitionSessionNavigation(
  previous: SessionNavigationState,
  snapshot: SessionListSnapshot,
): SessionNavigationTransition {
  if (snapshot.phase !== 'ready') return { close: false, state: previous }

  const current = snapshot.current === '' ? undefined : snapshot.current
  if (!previous.ready) return { close: false, state: { current, ready: true } }

  return {
    close: current !== undefined && current !== previous.current,
    state: { current, ready: true },
  }
}

export function initialSessionNavigationState(): SessionNavigationState {
  return { current: undefined, ready: false }
}
