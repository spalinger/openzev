import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, useEffect } from 'react'
import { useInvoiceActions } from '../src/features/invoices/useInvoiceActions'

const pushToast = vi.fn()
const invalidateQueries = vi.fn()
const t = (key: string) => key

const mutationInstances: Array<{
  mutate: ReturnType<typeof vi.fn>
  mutateAsync: ReturnType<typeof vi.fn>
  isPending: boolean
  options: Record<string, unknown>
}> = []

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t }),
}))

vi.mock('../src/lib/toast', () => ({
  useToast: () => ({ pushToast }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useMutation: (options: Record<string, unknown>) => {
    const instance = {
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      options,
    }
    mutationInstances.push(instance)
    return instance
  },
}))

vi.mock('../src/lib/api/invoices', () => ({
  approveAllInvoices: vi.fn(),
  approveInvoice: vi.fn(),
  deleteInvoice: vi.fn(),
  downloadAllPdfs: vi.fn(),
  fetchInvoice: vi.fn(),
  generateAllPdfs: vi.fn(),
  generateInvoice: vi.fn(),
  generateInvoicePdf: vi.fn(),
  generateInvoicesForZev: vi.fn(),
  markInvoicePaid: vi.fn(),
  markInvoiceSent: vi.fn(),
  retryFailedEmail: vi.fn(),
  sendAllInvoices: vi.fn(),
  sendInvoiceEmail: vi.fn(),
}))

function createHarness() {
  const latestResult = { current: null as ReturnType<typeof useInvoiceActions> | null }

  function Harness() {
    const hookResult = useInvoiceActions({
      selectedZevId: 'zev-1',
      period: {
        period_start: '2026-05-01',
        period_end: '2026-05-31',
      },
      rows: [
        {
          participant_id: 'participant-1',
          invoice: null,
        },
        {
          participant_id: 'participant-2',
          invoice: {
            id: 'invoice-draft',
            status: 'draft',
            pdf_url: null,
            email_logs: [],
            invoice_number: 'INV-001',
          },
        },
        {
          participant_id: 'participant-3',
          invoice: {
            id: 'invoice-approved',
            status: 'approved',
            pdf_url: null,
            email_logs: [],
            invoice_number: 'INV-002',
          },
        },
        {
          participant_id: 'participant-4',
          invoice: {
            id: 'invoice-sent',
            status: 'sent',
            pdf_url: '/pdf/invoice-sent.pdf',
            email_logs: [
              {
                id: 'email-log-1',
                created_at: '2026-05-08T10:00:00Z',
                recipient: 'recipient@example.com',
                status: 'sent',
              },
            ],
            invoice_number: 'INV-003',
          },
        },
      ] as any,
      userRole: 'participant',
      onOpenEmailLogs: vi.fn(),
      onDeleteClick: vi.fn(),
    })

    useEffect(() => {
      latestResult.current = hookResult
    }, [hookResult])

    return null
  }

  return { Harness, getResult: () => latestResult.current }
}

describe('useInvoiceActions hook', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mutationInstances.length = 0
    pushToast.mockClear()
    invalidateQueries.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('returns row actions and batch recommendation from hook state', () => {
    const { Harness, getResult } = createHarness()

    act(() => {
      root.render(createElement(Harness))
    })

    const result = getResult()
    expect(result).not.toBeNull()

    const noInvoiceAction = result!.getPrimaryRowAction({ participant_id: 'participant-1', invoice: null } as any)
    const draftAction = result!.getPrimaryRowAction({ participant_id: 'participant-2', invoice: { status: 'draft' } as any } as any)
    const approvedAction = result!.getPrimaryRowAction({ participant_id: 'participant-3', invoice: { id: 'invoice-approved', status: 'approved' } as any } as any)
    const sentAction = result!.getPrimaryRowAction({ participant_id: 'participant-4', invoice: { id: 'invoice-sent', status: 'sent' } as any } as any)

    expect(noInvoiceAction?.label).toBe('pages.invoices.generateInvoice')
    expect(draftAction?.label).toBe('pages.invoices.approve')
    expect(approvedAction?.label).toBe('pages.invoices.sendEmail')
    expect(sentAction?.label).toBe('pages.invoices.markPaid')
    expect(result!.recommendedBatchAction?.label).toBe('pages.invoices.batch.approveAll')
    expect(result!.getRowMenuItems({ participant_id: 'participant-4', invoice: { id: 'invoice-sent', status: 'sent', pdf_url: '/pdf/invoice-sent.pdf', email_logs: [], invoice_number: 'INV-003' } as any } as any)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'regenerate-pdf' }),
        expect.objectContaining({ key: 'resend-email' }),
      ]),
    )
  })

  it('tracks retry-email state and forwards settle callbacks', async () => {
    const { Harness, getResult } = createHarness()

    act(() => {
      root.render(createElement(Harness))
    })

    const result = getResult()
    expect(result).not.toBeNull()

    await act(async () => {
      result!.handleRetryEmail('invoice-approved', 'log-1')
    })

    expect(getResult()!.retiringEmailId).toBe('log-1')
    expect(mutationInstances[7]?.mutate).toHaveBeenCalledWith(
      { invoiceId: 'invoice-approved', emailLogId: 'log-1' },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    )

    await act(async () => {
      const call = mutationInstances[7]?.mutate.mock.calls[0]
      const options = call?.[1] as { onSettled?: () => void }
      options?.onSettled?.()
    })

    expect(getResult()!.retiringEmailId).toBeNull()
  })
})
