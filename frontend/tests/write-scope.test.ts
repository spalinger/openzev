import { act, createElement, StrictMode, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useWriteScope } from '../src/lib/useWriteScope'

let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
let result: ReturnType<typeof useWriteScope>
let params: Parameters<typeof useWriteScope>[0]
function Harness() {
    const current = useWriteScope(params, 'write denied')
    useLayoutEffect(() => { result = current }, [current])
    return null
}
function render() {
    act(() => root.render(createElement(StrictMode, null, createElement(Harness))))
}
beforeEach(() => {
    params = { selectedZevId: 'A', canWrite: true, accountId: 1 }
    container = document.createElement('div')
    root = createRoot(container)
    render()
})
afterEach(() => act(() => root.unmount()))

it('keeps scope identity across unrelated renders and supports StrictMode effect replay', () => {
    const original = result.scope
    render()
    expect(result.scope).toBe(original)
    expect(result.isCurrent(original)).toBe(true)
    expect(() => result.assertWritable(original)).not.toThrow()
})

it.each(['community', 'permission', 'account'] as const)('revokes retained and queued callbacks after a %s change, even when returning', change => {
    const original = result.scope
    const { isCurrent, assertWritable } = result
    const previous = { ...params }
    if (change === 'community') params.selectedZevId = 'B'
    if (change === 'permission') params.canWrite = false
    if (change === 'account') params.accountId = 2
    render()
    expect(isCurrent(original)).toBe(false)
    expect(() => assertWritable(original)).toThrow('write denied')
    params = previous
    render()
    expect(result.isCurrent(original)).toBe(false)
    expect(() => result.assertWritable(result.scope)).not.toThrow()
})

it('revokes scope on unmount', () => {
    const { scope, isCurrent, assertWritable } = result
    act(() => root.unmount())
    expect(isCurrent(scope)).toBe(false)
    expect(() => assertWritable(scope)).toThrow('write denied')
})

it('requires write capability and a community unless explicitly operating across communities', () => {
    params.selectedZevId = null
    render()
    expect(() => result.assertWritable(result.scope)).toThrow('write denied')
    expect(() => result.assertWritable(result.scope, false)).not.toThrow()
    params.canWrite = false
    render()
    expect(() => result.assertWritable(result.scope, false)).toThrow('write denied')
})
