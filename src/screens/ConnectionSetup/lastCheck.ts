import type { ConnectionProblem } from '../../llm/diagnose'

// The problem found by onboarding's quiet connection check, so the setup screen can say what
// went wrong. In memory only: a reload starts fresh.
//
// The setup screen reads it while rendering (peekOnboardingProblem, a pure read) and clears it
// once it has mounted (clearOnboardingProblem, in an effect). Taking it during render lost it
// whenever React threw that first render away and rendered again (a render interrupted or
// restarted while the lazy screen was being revealed), and the note never showed.
let lastProblem: ConnectionProblem | null = null

export function setOnboardingProblem(p: ConnectionProblem | null): void {
  lastProblem = p
}

/** The problem, left in place (safe to call during render). */
export function peekOnboardingProblem(): ConnectionProblem | null {
  return lastProblem
}

/** Forget the problem: call after the screen that shows it has mounted. */
export function clearOnboardingProblem(): void {
  lastProblem = null
}
