/** Return the compact uppercase representation used by the API. */
export function normalizeIban(value: string): string {
    return value.replace(/\s/g, '').toUpperCase()
}

export function isValidIban(value: string): boolean {
    const iban = normalizeIban(value)
    if (!iban || !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false
    const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`
    const numeric = [...rearranged].map((char) => /[A-Z]/.test(char)
        ? String(char.charCodeAt(0) - 55)
        : char).join('')
    let remainder = 0
    for (const chunk of numeric.match(/.{1,7}/g) ?? []) remainder = Number(`${remainder}${chunk}`) % 97
    return remainder === 1
}
