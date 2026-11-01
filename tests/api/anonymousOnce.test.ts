import { describe, expect, it, vi } from 'vitest'
import { ANON_LOCK, anonymousOnce } from '@/api/cloudAuth'
import type { AuthUser, PrerenderDoc } from '@/api/cloudAuth'

/** Candado como el de Web Locks: una petición a la vez por nombre. */
function fakeLocks() {
  let tail = Promise.resolve()
  const names: string[] = []
  return {
    names,
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      names.push(name)
      const run = tail.then(callback)
      tail = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    },
  }
}

describe('anonymousOnce', () => {
  it('dos pestañas a la vez sin sesión crean una sola cuenta', async () => {
    let stored: AuthUser | null = null
    const signIn = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 5))
      stored = { id: `anon-${signIn.mock.calls.length}`, email: null }
      return stored
    })
    const locks = fakeLocks()
    const deps = { session: async () => stored, signIn, locks, doc: null }
    const [a, b] = await Promise.all([anonymousOnce(deps), anonymousOnce(deps)])
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
    expect(locks.names).toEqual([ANON_LOCK, ANON_LOCK])
  })

  it('con sesión guardada no crea cuenta; sin Web Locks igual funciona', async () => {
    const signIn = vi.fn(async () => ({ id: 'nueva', email: null }))
    const user = { id: 'guardada', email: null }
    expect(await anonymousOnce({ session: async () => user, signIn, locks: null, doc: null })).toBe(
      user,
    )
    expect(signIn).not.toHaveBeenCalled()
    expect(
      await anonymousOnce({ session: async () => null, signIn, locks: null, doc: null }),
    ).toEqual({ id: 'nueva', email: null })
  })

  it('una precarga de Chrome espera a mostrarse antes de crear la cuenta', async () => {
    const target = new EventTarget()
    const doc = {
      prerendering: true,
      addEventListener: target.addEventListener.bind(target),
    } as PrerenderDoc
    const signIn = vi.fn(async () => ({ id: 'anon', email: null }))
    const pending = anonymousOnce({ session: async () => null, signIn, locks: null, doc })
    await new Promise(r => setTimeout(r, 0))
    expect(signIn).not.toHaveBeenCalled()
    target.dispatchEvent(new Event('prerenderingchange'))
    expect(await pending).toEqual({ id: 'anon', email: null })
  })
})
