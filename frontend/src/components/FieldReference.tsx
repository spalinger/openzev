import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TemplateFieldGroup } from '../types/api'

export interface FieldReferenceProps {
    groups: TemplateFieldGroup[]
    /** Current template content; enables the per-field usage badge. */
    content?: string
    /** Called on click; the second argument is true for shift-click. */
    onInsert?: (variable: string, keepFocus: boolean) => void
}

/**
 * Insert a template token at the caret of a textarea/input.
 *
 * Loop tags (``{% for … %}``) insert as an indented block with the caret
 * placed inside, ready to receive the loop body. With ``keepFocus`` the caret
 * stays where it was (used by shift-click, which never moves focus).
 */
export function insertTemplateToken(
    element: HTMLTextAreaElement | HTMLInputElement,
    variable: string,
    keepFocus: boolean,
): void {
    const start = element.selectionStart ?? element.value.length
    const end = element.selectionEnd ?? element.value.length
    let insertText = variable
    let cursorOffset = insertText.length
    if (variable.startsWith('{%')) {
        insertText = `${variable}\n    \n{% endfor %}`
        cursorOffset = variable.length + '\n    '.length
    }
    const nextValue = element.value.slice(0, start) + insertText + element.value.slice(end)
    element.value = nextValue
    if (!keepFocus) {
        element.focus()
        element.setSelectionRange(start + cursorOffset, start + cursorOffset)
    } else {
        element.setSelectionRange(start, start)
    }
}

export function tokenInner(variable: string): string {
    const open = variable.startsWith('{{') || variable.startsWith('{%') ? 2 : 1
    const close = variable.endsWith('}}') || variable.endsWith('%}') ? 2 : 1
    return variable.slice(open, variable.length - close).trim()
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Count how often a template token occurs, tolerating whitespace inside the braces. */
export function countTokenOccurrences(content: string, variable: string): number {
    const inner = escapeRegExp(tokenInner(variable))
    const open = variable.startsWith('{{') ? '\\{\\{' : variable.startsWith('{%') ? '\\{%' : '\\{'
    const close = variable.endsWith('}}') ? '\\}\\}' : variable.endsWith('%}') ? '\\%\\}' : '\\}'
    const pattern = new RegExp(`${open}\\s*${inner}\\s*${close}`, 'g')
    return (content.match(pattern) ?? []).length
}

export function FieldReference({ groups, content, onInsert }: FieldReferenceProps) {
    const { t } = useTranslation()
    const [query, setQuery] = useState('')

    const visibleGroups = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (!needle) {
            return groups
        }
        return groups
            .map((group) => ({
                ...group,
                fields: group.fields.filter(
                    (field) =>
                        field.variable.toLowerCase().includes(needle) ||
                        t(field.description_key).toLowerCase().includes(needle),
                ),
            }))
            .filter((group) => group.fields.length > 0)
    }, [groups, query, t])

    const counts = useMemo(() => {
        if (!content) {
            return null
        }
        const map = new Map<string, number>()
        for (const group of groups) {
            for (const field of group.fields) {
                map.set(field.variable, countTokenOccurrences(content, field.variable))
            }
        }
        return map
    }, [groups, content])

    return (
        <aside className="card page-stack" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
            <h4 style={{ margin: 0 }}>{t('admin.availableFields')}</h4>
            <input
                type="search"
                aria-label={t('admin.fieldSearchPlaceholder')}
                placeholder={t('admin.fieldSearchPlaceholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                style={{ width: '100%' }}
            />
            {visibleGroups.length === 0 && (
                <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
                    {t('admin.noMatchingFields')}
                </p>
            )}
            {visibleGroups.map((group) => (
                <div key={group.group_key}>
                    {group.group_title_key && (
                        <h5 style={{ margin: '0.75rem 0 0.25rem' }}>{t(group.group_title_key)}</h5>
                    )}
                    <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                        <tbody>
                            {group.fields.map((field) => {
                                const count = counts?.get(field.variable)
                                const isOutputToken = field.variable.startsWith('{{')
                                return (
                                    <tr key={field.variable}>
                                        <td style={{ padding: '0.25rem 0.5rem 0.25rem 0', whiteSpace: 'nowrap' }}>
                                            {onInsert ? (
                                                <button
                                                    type="button"
                                                    className="field-reference-token"
                                                    onMouseDown={(event) => {
                                                        // Keep the editor focused for shift-click insertion; otherwise
                                                        // the browser focuses this button before onClick runs.
                                                        if (event.shiftKey) {
                                                            event.preventDefault()
                                                        }
                                                    }}
                                                    onClick={(event) => onInsert(field.variable, event.shiftKey)}
                                                    title={t('admin.clickToInsert')}
                                                >
                                                    {field.variable}
                                                </button>
                                            ) : (
                                                field.variable
                                            )}
                                        </td>
                                        <td className="muted" style={{ padding: '0.25rem 0.5rem 0.25rem 0' }}>
                                            <div>{t(field.description_key)}</div>
                                            {isOutputToken && field.example && (
                                                <div style={{ fontStyle: 'italic', fontSize: '0.78rem' }}>
                                                    {t('admin.example')}: {field.example}
                                                </div>
                                            )}
                                        </td>
                                        {counts && (
                                            <td style={{ padding: '0.25rem 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                {count !== undefined && count > 0 && (
                                                    <span className="badge badge-info">×{count}</span>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            ))}
        </aside>
    )
}
