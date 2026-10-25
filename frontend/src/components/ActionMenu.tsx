import { Fragment, useMemo, useRef, type ReactNode } from 'react'
import { Menu } from '@mantine/core'
import { closePopupOnEscape } from '../lib/popupKeyboard'

export interface ActionMenuItem {
    key: string
    label: string
    icon?: ReactNode
    onClick: () => void
    disabled?: boolean
    danger?: boolean
    section?: string
}

interface ActionMenuProps {
    label: string
    items: ActionMenuItem[]
    icon?: ReactNode
    iconOnly?: boolean
    /** Row-level size by default; `false` for a page toolbar, beside full-size buttons. */
    compact?: boolean
    /** Stable key for restoring trigger focus. */
    actionKey?: string
}

export function ActionMenu({ label, items, icon, iconOnly = false, compact = true, actionKey }: ActionMenuProps) {
    const triggerRef = useRef<HTMLButtonElement>(null)
    const hasEnabledItem = items.some(item => !item.disabled)
    const renderedItems = useMemo(() => {
        return items.map((item, index) => {
            const previousSection = index > 0 ? items[index - 1]?.section : undefined
            const showSection = item.section && item.section !== previousSection

            return {
                item,
                showSection,
                showDivider: index > 0 && showSection,
            }
        })
    }, [items])

    return (
        <Menu
            position="bottom-end"
            withinPortal
            shadow="md"
            middlewares={{ size: true }}
            transitionProps={{ transition: 'pop-top-right' }}
        >
            <Menu.Target>
                <button
                    ref={triggerRef}
                    type="button"
                    className={`button button-secondary${compact ? ' button-compact' : ''}`}
                    disabled={!hasEnabledItem}
                    aria-haspopup="menu"
                    data-action-key={actionKey}
                    onKeyDown={closePopupOnEscape}
                    aria-label={iconOnly ? label : undefined}
                    title={iconOnly ? label : undefined}
                >
                    {icon ? <span className="menu-item-icon" aria-hidden="true">{icon}</span> : null}
                    {iconOnly ? null : label}
                </button>
            </Menu.Target>
            <Menu.Dropdown className="action-menu-dropdown">
                {renderedItems.map(({ item, showSection, showDivider }) => (
                    <Fragment key={item.key}>
                        {showDivider && <Menu.Divider />}
                        {showSection && <Menu.Label>{item.section}</Menu.Label>}
                        <Menu.Item
                            disabled={item.disabled}
                            leftSection={item.icon ? <span className="menu-item-icon" aria-hidden="true">{item.icon}</span> : undefined}
                            className={item.danger ? 'action-menu-item-danger' : undefined}
                            onClick={() => {
                                // A dialog opened by the action must return to the persistent trigger.
                                triggerRef.current?.focus()
                                item.onClick()
                            }}
                        >
                            {item.label}
                        </Menu.Item>
                    </Fragment>
                ))}
            </Menu.Dropdown>
        </Menu>
    )
}
