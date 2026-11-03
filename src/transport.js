// Camada de transporte: no navegador usa o WebSocket padrão; no app Android
// (Capacitor) usa o plugin nativo "TvSocket", que aceita o certificado
// autoassinado da TV e consegue varrer a rede em busca dela.

import { Capacitor, registerPlugin } from '@capacitor/core'

const TvSocket = registerPlugin('TvSocket')

export const CONNECTING = 0
export const OPEN = 1
export const CLOSING = 2
export const CLOSED = 3

export const isNative = () => {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

let nextId = 1
const sockets = new Map()
let listening = false

function ensureListener() {
  if (listening) return
  listening = true
  TvSocket.addListener('tvSocket', (ev) => {
    const s = sockets.get(ev.id)
    if (s) s._dispatch(ev.type, ev.data)
  })
}

class NativeSocket {
  constructor(url) {
    ensureListener()
    this.id = nextId++
    this.readyState = CONNECTING
    this.onopen = null
    this.onmessage = null
    this.onclose = null
    this.onerror = null
    sockets.set(this.id, this)
    TvSocket.open({ id: this.id, url }).catch(() => {
      this._dispatch('error')
      this._dispatch('close')
    })
  }

  _dispatch(type, data) {
    if (type === 'open') {
      this.readyState = OPEN
      if (this.onopen) this.onopen({})
    } else if (type === 'message') {
      if (this.onmessage) this.onmessage({ data })
    } else if (type === 'error') {
      if (this.onerror) this.onerror({})
    } else if (type === 'close') {
      if (this.readyState === CLOSED) return
      this.readyState = CLOSED
      sockets.delete(this.id)
      if (this.onclose) this.onclose({})
    }
  }

  send(data) {
    TvSocket.send({ id: this.id, data }).catch(() => {})
  }

  close() {
    if (this.readyState === CLOSED) return
    this.readyState = CLOSING
    TvSocket.close({ id: this.id }).catch(() => {})
    // garante o fechamento mesmo se o nativo não avisar
    setTimeout(() => this._dispatch('close'), 500)
  }
}

export function createSocket(url) {
  return isNative() ? new NativeSocket(url) : new WebSocket(url)
}

// Chamada HTTP direta à TV (somente no app Android; no navegador o CORS bloqueia).
// Devolve { status, body }; status -1 = falha de conexão.
export async function rest(method, url) {
  if (!isNative()) return { status: -1, body: 'só no app Android' }
  try {
    return await TvSocket.rest({ method, url })
  } catch (e) {
    return { status: -1, body: String((e && e.message) || e) }
  }
}

// Procura TVs Samsung na rede Wi-Fi (somente no app Android).
export async function discoverSamsungTvs() {
  if (!isNative()) return []
  const r = await TvSocket.discover()
  return (r && r.tvs) || []
}
