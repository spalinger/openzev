import { useState, type ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown } from '@fortawesome/free-solid-svg-icons'

type TariffDisclosureProps = {
    summary: ReactNode
    children: ReactNode
}

/** Mount secondary content only while its native disclosure is open. */
export function TariffDisclosure({ summary, children }: TariffDisclosureProps) {
    const [open, setOpen] = useState(false)
    return (
        <details className="tariff-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary>
                <span>{summary}</span>
                <FontAwesomeIcon className="tariff-disclosure-chevron" icon={faChevronDown} fixedWidth />
            </summary>
            {open && children}
        </details>
    )
}
