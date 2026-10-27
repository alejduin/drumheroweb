import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuthStore } from '@/store/authStore'
import { TextField } from '@/ui/library/TextField'
import { Button, Panel } from '@/ui/primitives'

/** Cuenta en la nube: vincular el correo o entrar desde otro equipo (PLAN_V2 B12). */
export function AccountPanel() {
  const status = useAuthStore(s => s.status)
  const user = useAuthStore(s => s.user)
  const pending = useAuthStore(s => s.pending)
  const busy = useAuthStore(s => s.busy)
  const error = useAuthStore(s => s.error)
  const [mode, setMode] = useState<'link' | 'signin'>('link')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')

  if (status === 'off') return null

  const auth = useAuthStore.getState()

  function onRequest(e: FormEvent) {
    e.preventDefault()
    void auth.requestCode(mode, email)
  }

  function onConfirm(e: FormEvent) {
    e.preventDefault()
    void auth.confirmCode(code).then(() => setCode(''))
  }

  const errorLine = error && (
    <p role="alert" className="text-xs text-miss">
      {error}
    </p>
  )

  if (status === 'connecting') {
    return (
      <Panel title="Cuenta" aside="nube">
        <p className="text-sm text-muted">Conectando con la nube…</p>
      </Panel>
    )
  }

  if (status === 'error') {
    return (
      <Panel title="Cuenta" aside="sin conexión">
        <p className="text-sm text-fg-2">
          No se pudo conectar con la nube. Las canciones de este navegador se pueden jugar igual.
        </p>
        {errorLine}
        <Button size="sm" className="self-start" disabled={busy} onClick={() => void auth.init()}>
          Reintentar
        </Button>
      </Panel>
    )
  }

  if (user?.email) {
    return (
      <Panel title="Cuenta" aside="sincronizada">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-fg-2">
            Conectado como <span className="font-semibold text-fg">{user.email}</span>. Tus
            canciones se abren en cualquier equipo con este correo.
          </p>
          <Button size="sm" disabled={busy} onClick={() => void auth.signOut()}>
            Cerrar sesión
          </Button>
        </div>
        {errorLine}
      </Panel>
    )
  }

  if (pending) {
    return (
      <Panel title="Cuenta" aside="código por correo">
        <form onSubmit={onConfirm} className="flex flex-col gap-3">
          <p className="text-sm text-fg-2">
            Te enviamos un código de 6 dígitos a{' '}
            <span className="font-semibold text-fg">{pending.email}</span>.
          </p>
          <div className="flex items-end gap-2">
            <TextField
              id="account-code"
              className="w-40"
              label="Código"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value)}
              error={error}
            />
            <Button type="submit" variant="primary" disabled={busy || code.trim().length < 6}>
              {busy ? 'Comprobando…' : 'Confirmar'}
            </Button>
            <Button type="button" disabled={busy} onClick={() => auth.cancelCode()}>
              Cancelar
            </Button>
          </div>
        </form>
      </Panel>
    )
  }

  const linking = mode === 'link'
  return (
    <Panel title="Cuenta" aside="anónima · solo este navegador">
      <form onSubmit={onRequest} className="flex flex-col gap-3">
        <p className="text-sm text-fg-2">
          {linking
            ? 'Tus canciones se guardan en la nube. Vincula tu correo para abrirlas en otros equipos.'
            : 'Entra con el correo que vinculaste en otro equipo. Las canciones de esta cuenta anónima dejarán de verse aquí.'}
        </p>
        <div className="flex items-end gap-2">
          <TextField
            id="account-email"
            className="flex-1"
            type="email"
            label="Correo"
            placeholder="tu@correo.com"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            error={error}
          />
          <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
            {busy ? 'Enviando…' : 'Enviar código'}
          </Button>
        </div>
        <button
          type="button"
          className="cursor-pointer self-start text-xs font-semibold text-accent underline-offset-2 hover:underline"
          onClick={() => {
            setMode(linking ? 'signin' : 'link')
            auth.cancelCode()
          }}
        >
          {linking
            ? '¿Ya vinculaste tu correo? Entrar con mi correo'
            : 'Vincular este navegador a mi correo'}
        </button>
      </form>
    </Panel>
  )
}
