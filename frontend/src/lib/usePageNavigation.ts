import { useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

/**
 * URL edits shared by routed hubs and query controls. Callers own tab policy.
 * Each update starts from the last committed location: combine related edits
 * in one callback rather than issuing multiple updates before navigation commits.
 */
export function usePageNavigation() {
    const location = useLocation()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()

    const updateParams = useCallback((
        edit: (params: URLSearchParams) => void,
        { pathname = location.pathname, replace = true }: { pathname?: string; replace?: boolean } = {},
    ) => {
        const params = new URLSearchParams(location.search)
        edit(params)
        navigate({ pathname, search: params.toString(), hash: location.hash }, { replace, state: location.state })
    }, [location, navigate])

    const navigateTab = useCallback((pathname: string) => {
        updateParams(() => {}, { pathname })
    }, [updateParams])

    return { searchParams, updateParams, navigateTab }
}
