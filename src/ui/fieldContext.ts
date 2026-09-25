import { createContext, useContext, useId } from 'react'

export interface FieldContextValue {
  id: string
  labelId: string
  describedBy?: string
  invalid: boolean
  required: boolean
}

export const FieldContext = createContext<FieldContextValue | null>(null)

/** Field wiring for a control: id, aria-describedby, aria-invalid, and the label's id. */
export function useField(explicitId?: string) {
  const ctx = useContext(FieldContext)
  const fallback = useId()
  return {
    id: explicitId ?? ctx?.id ?? fallback,
    labelId: ctx?.labelId,
    describedBy: ctx?.describedBy,
    invalid: ctx?.invalid ?? false,
    required: ctx?.required ?? false,
  }
}
