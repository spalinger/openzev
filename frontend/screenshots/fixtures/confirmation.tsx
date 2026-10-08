import { createRoot } from 'react-dom/client'
import { useLayoutEffect, useState } from 'react'
import { ConfirmDialog, useConfirmDialog } from '../../src/components/ConfirmDialog'
import { FormModal } from '../../src/components/FormModal'
import { ToastProvider } from '../../src/lib/toast'

type Scene = 'stack' | 'tabbability'
let ready: Promise<void> | undefined

function ConfirmationFixture({ scene, onReady }: { scene: Scene; onReady: () => void }) {
  const { dialog, confirm, handleConfirm, handleCancel, isLoading } = useConfirmDialog()
  const [isOpen, setOpen] = useState(true)
  useLayoutEffect(onReady, [onReady])
  return <>
    {dialog && <ConfirmDialog {...dialog} isLoading={isLoading} onConfirm={handleConfirm} onCancel={handleCancel} />}
    <FormModal isOpen={isOpen} title="Fixture form" onClose={() => setOpen(false)}>
      {scene === 'stack' ? <button onClick={() => confirm({
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
    </FormModal>
  </>
}

export function mountConfirmation(scene: Scene = 'stack'): Promise<void> {
  if (ready) return ready
  const host = document.createElement('div')
  host.id = 'confirmation-fixture'
  document.body.append(host)
  const root = createRoot(host)
  ready = new Promise(resolve => {
    root.render(<ToastProvider><ConfirmationFixture scene={scene} onReady={resolve} /></ToastProvider>)
  })
  return ready
}
