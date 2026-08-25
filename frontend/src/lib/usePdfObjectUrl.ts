import { useEffect, useState } from 'react'

/**
 * Authenticated blob-fetch → object URL pattern for PDF embeds.
 * All callers go through API endpoints (not /media/) so auth + 401-refresh
 * works everywhere.
 */
export function usePdfObjectUrl(
  fetcher: (() => Promise<Blob>) | null,
  enabled: boolean,
): {
  url: string | null
  loading: boolean
  error: boolean
} {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!enabled || !fetcher) {
      setUrl(null)
      return
    }

    let objectUrl: string | null = null
    let cancelled = false
    setLoading(true)
    setError(false)

    void fetcher()
      .then((blob) => {
        if (cancelled) return
        if (blob.type !== 'application/pdf') throw new Error('Not a PDF')
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [enabled, fetcher])

  return { url, loading, error }
}