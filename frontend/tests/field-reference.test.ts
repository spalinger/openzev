import { describe, expect, it } from 'vitest'
import { countTokenOccurrences, insertTemplateToken, tokenInner } from '../src/components/FieldReference'

function textarea(initial: string, selectionStart = 0, selectionEnd = 0): HTMLTextAreaElement {
  const el = document.createElement('textarea')
  el.value = initial
  el.setSelectionRange(selectionStart, selectionEnd)
  return el
}

describe('countTokenOccurrences', () => {
  it('counts pdf output tokens regardless of whitespace inside the braces', () => {
    const content = '{{ participant.full_name }}\nHi {{participant.full_name}}'
    expect(countTokenOccurrences(content, '{{ participant.full_name }}')).toBe(2)
  })

  it('counts pdf loop tags', () => {
    const content = '{% for row in local_tariff_rows %}\n…\n{% endfor %}'
    expect(countTokenOccurrences(content, '{% for row in local_tariff_rows %}')).toBe(1)
  })

  it('counts email tokens', () => {
    const content = 'Invoice {invoice_number} for {invoice_number}'
    expect(countTokenOccurrences(content, '{invoice_number}')).toBe(2)
  })

  it('returns zero when the token is absent', () => {
    expect(countTokenOccurrences('nothing here', '{{ invoice.total_chf }}')).toBe(0)
  })

  it('escapes regex metacharacters in the token', () => {
    const content = '{{ savings_data.saved_chf|safe }} and {{ savings_data.saved_chf|safe }}'
    expect(countTokenOccurrences(content, '{{ savings_data.saved_chf|safe }}')).toBe(2)
  })
})

describe('insertTemplateToken', () => {
  it('inserts a variable at the caret', () => {
    const el = textarea('Hello ', 6, 6)
    insertTemplateToken(el, '{{ participant.full_name }}', false)
    expect(el.value).toBe('Hello {{ participant.full_name }}')
    expect(el.selectionStart).toBe(el.value.length)
  })

  it('replaces the selection', () => {
    const el = textarea('Hi [old] there', 3, 8)
    insertTemplateToken(el, '{zev_name}', false)
    expect(el.value).toBe('Hi {zev_name} there')
  })

  it('inserts loop tags as an indented block with the caret inside', () => {
    const el = textarea('', 0, 0)
    insertTemplateToken(el, '{% for item in group.items %}', false)
    expect(el.value).toBe('{% for item in group.items %}\n    \n{% endfor %}')
    expect(el.value.slice(el.selectionStart - 4, el.selectionStart)).toBe('    ')
  })

  it('inserts without moving the caret when keepFocus is set', () => {
    const el = textarea('abc', 1, 1)
    insertTemplateToken(el, '{verify_url}', true)
    expect(el.value).toBe('a{verify_url}bc')
    expect(el.selectionStart).toBe(1)
  })
})

describe('tokenInner', () => {
  it('strips pdf braces', () => {
    expect(tokenInner('{{ participant.full_name }}')).toBe('participant.full_name')
  })

  it('strips loop-tag braces', () => {
    expect(tokenInner('{% for group in grouped_items %}')).toBe('for group in grouped_items')
  })

  it('strips single email braces', () => {
    expect(tokenInner('{temporary_password}')).toBe('temporary_password')
  })
})
