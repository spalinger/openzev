import { createRoot } from 'react-dom/client'
import { StrictMode, useLayoutEffect, useState } from 'react'
import { MantineProvider, Select } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { mantineTheme } from '../../src/lib/mantineTheme'
import { ConfirmDialog, useConfirmDialog } from '../../src/components/ConfirmDialog'
import { ActionMenu } from '../../src/components/ActionMenu'
import { FormModal } from '../../src/components/FormModal'
import { ToastProvider } from '../../src/lib/toast'

type Scene = 'stack' | 'tabbability' | 'nested' | 'simultaneous' | 'portals'
let ready: Promise<void> | undefined

function ConfirmationFixture({ scene, onReady }: { scene: Scene; onReady: () => void }) {
  const { dialog, confirm, handleConfirm, handleCancel, isLoading } = useConfirmDialog()
  const [isOpen, setOpen] = useState(true)
  const [choice, setChoice] = useState<string | null>(null)
  const [childOpen, setChildOpen] = useState(scene === 'simultaneous')
  const [date, setDate] = useState<string | null>(null)
  useLayoutEffect(onReady, [onReady])
  const nested = scene === 'nested' || scene === 'simultaneous'
  const confirmation = dialog && <ConfirmDialog {...dialog} isLoading={isLoading} onConfirm={handleConfirm} onCancel={handleCancel} />
  return <>
    {!nested && confirmation}
    <FormModal isOpen={isOpen} title="Fixture form" onClose={() => setOpen(false)}>
      {scene === 'portals' ? <>
        <Select label="Fixture choice" data={['One', 'Two']} value={choice} onChange={setChoice} />
        <DatePickerInput label="Fixture date" value={date} onChange={setDate} defaultDate="2026-10-01" />
        <ActionMenu label="Fixture menu" items={[{ key: 'action', label: 'Fixture action', onClick: () => setChoice('Two') }]} />
      </> : scene !== 'tabbability' ? <button onClick={() => confirm({
        title: 'Fixture confirmation', message: 'Confirm the pending action.',
        onConfirm: () => new Promise<void>(() => {}),
      })}>Open confirmation</button> : <>
        <input type="hidden" />
        <input tabIndex={-1} />
        <fieldset disabled><button>Disabled</button></fieldset>
        <div inert><button>Inert</button></div>
        <div hidden><button>Hidden before</button></div>
        <button>Real action</button>
        <div hidden><button>Hidden after</button></div>
        <input type="hidden" />
      </>}
      {nested && confirmation}
      {childOpen && <ConfirmDialog title="Fixture child" message="Confirm" onConfirm={() => {}} onCancel={() => setChildOpen(false)} />}
    </FormModal>
  </>
}

export function mountConfirmation(scene: Scene = 'stack', strict = false): Promise<void> {
  if (ready) return ready
  const host = document.createElement('div')
  host.id = 'confirmation-fixture'
  document.body.append(host)
  const root = createRoot(host)
  ready = new Promise(resolve => {
    const fixture = <ToastProvider><MantineProvider theme={mantineTheme}>
      <ConfirmationFixture scene={scene} onReady={resolve} />
    </MantineProvider></ToastProvider>
    root.render(strict ? <StrictMode>{fixture}</StrictMode> : fixture)
  })
  return ready
}
