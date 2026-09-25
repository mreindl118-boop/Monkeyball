import type { ConnectionProblem } from '../../llm/diagnose'

// The problem found by onboarding's quiet connection check, so the setup screen can say what
// went wrong. In memory only: a reload starts fresh.
let lastProblem: ConnectionProblem | null = null

export function setOnboardingProblem(p: ConnectionProblem | null): void {
  lastProblem = p
}

export function takeOnboardingProblem(): ConnectionProblem | null {
  const p = lastProblem
  lastProblem = null
  return p
}
