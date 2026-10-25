import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/** Ignore UI completion after closing a task, changing scope or unmounting. */
export function useEditingSession(scope: unknown) {
  const id = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const start = useCallback(() => {
    id.current += 1
    setError(null)
  }, [])
  const isCurrent = useCallback((submitted: number) => submitted === id.current, [])

  useLayoutEffect(() => {
    start()
    return () => { id.current += 1 }
  }, [scope, start])

  return { id, start, isCurrent, error, setError }
}
