// Driver LG webOS (EXPERIMENTAL: escrito pelo protocolo público SSAP, ainda não testado em TV real).
// Protocolo: WebSocket em ws://IP:3000 (app Android) ou wss://IP:3001 (navegador/PWA).
// Primeiro "register" (a TV mostra um pedido de autorização, devolve um client-key que guardamos),
// depois um segundo socket "pointer" por onde vão os botões (setas, OK, números...).
//
// Segue o mesmo contrato de samsung.js (connect, reconnect, disconnect, ready, key, launchApp,
// forgetPairing, onApps, onLog).

import { createSocket, OPEN, CONNECTING, isNative } from '../transport.js'

const TOKEN_KEY = 'tv_token_lg'
const MAX_RETRIES = 6

// vocabulário universal -> nome do botão no socket "pointer" da LG
const BUTTONS = {
  UP: 'UP',
  DOWN: 'DOWN',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  OK: 'ENTER',
  BACK: 'BACK',
  HOME: 'HOME',
  MENU: 'MENU',
  VOL_UP: 'VOLUMEUP',
  VOL_DOWN: 'VOLUMEDOWN',
  MUTE: 'MUTE',
  CH_UP: 'CHANNELUP',
  CH_DOWN: 'CHANNELDOWN',
  PLAY: 'PLAY',
  PAUSE: 'PAUSE',
  REW: 'REWIND',
  FF: 'FASTFORWARD',
  GUIDE: 'GUIDE',
  INFO: 'INFO',
  RED: 'RED',
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  BLUE: 'BLUE',
}
for (let i = 0; i <= 9; i++) BUTTONS[String(i)] = String(i)

// IDs padrão do webOS; se o app aparecer na lista da TV pelo nome, o ID real da TV é usado.
const APPS = {
  netflix: ['netflix'],
  youtube: ['youtube.leanback.v4'],
  prime: ['amazon'],
  disney: ['com.disney.disneyplus-prod'],
  www: ['com.webos.app.browser'],
  globo: ['globoplay'],
}
const APP_NAMES = {
  netflix: /netflix/i,
  youtube: /^youtube$/i,
  prime: /prime|amazon/i,
  disney: /disney/i,
  www: /web browser|navegador|browser/i,
  globo: /globo/i,
}

const PERMISSIONS = [
  'LAUNCH',
  'LAUNCH_WEBAPP',
  'APP_TO_APP',
  'CONTROL_AUDIO',
  'CONTROL_DISPLAY',
  'CONTROL_INPUT_JOYSTICK',
  'CONTROL_INPUT_MEDIA_PLAYBACK',
  'CONTROL_INPUT_TV',
  'CONTROL_INPUT_TEXT',
  'CONTROL_MOUSE_AND_KEYBOARD',
  'CONTROL_POWER',
  'READ_APP_STATUS',
  'READ_CURRENT_CHANNEL',
  'READ_INSTALLED_APPS',
  'READ_RUNNING_APPS',
]

const load = (k) => {
  try {
    return localStorage.getItem(k) || null
  } catch {
    return null
  }
}

export class LgDriver {
  constructor(onStatus) {
    this.onStatus = onStatus
    this.ws = null
    this.pointer = null
    this.ip = null
    this.key_ = load(TOKEN_KEY)
    this.attempt = 0
    this.closedByUser = false
    this.registered = false
    this.timer = null
    this.retryTimer = null
    this.retries = 0
    this.lastKick = 0
    this.apps = []
    this.onApps = null
    this.onLog = null
    this.logLines = []
    this.seq = 0
  }

  _log(line) {
    const t = new Date().toTimeString().slice(0, 8)
    this.logLines = [...this.logLines, `${t} ${line}`].slice(-14)
    if (this.onLog) this.onLog(this.logLines)
  }

  // app Android: tenta ws:3000 e depois wss:3001. Navegador: só wss:3001 (https não aceita ws://).
  _urls() {
    return isNative()
      ? [`ws://${this.ip}:3000`, `wss://${this.ip}:3001`]
      : [`wss://${this.ip}:3001`]
  }

  connect(ip) {
    this.disconnect()
    this.closedByUser = false
    this.ip = ip
    this.key_ = load(TOKEN_KEY)
    this.attempt = 0
    this.retries = 0
    this._open()
  }

  reconnect() {
    if (this.ip) this.connect(this.ip)
  }

  _open() {
    const urls = this._urls()
    const url = urls[Math.min(this.attempt, urls.length - 1)]
    this.onStatus('connecting', 'Conectando...')
    this._log(`abrindo ${url}`)

    let ws
    try {
      ws = createSocket(url)
    } catch {
      this.onStatus('error', 'Não foi possível abrir a conexão.')
      return
    }
    this.ws = ws
    this.registered = false

    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (this.ws === ws && ws.readyState !== OPEN) ws.close()
    }, 8000)

    let opened = false

    ws.onopen = () => {
      opened = true
      clearTimeout(this.timer)
      this.onStatus('auth', 'Aceite a conexão na TV (pop-up na tela).')
      const payload = {
        forcePairing: false,
        pairingType: 'PROMPT',
        manifest: { manifestVersion: 1, appVersion: '1.1', permissions: PERMISSIONS },
      }
      if (this.key_) payload['client-key'] = this.key_
      ws.send(JSON.stringify({ type: 'register', id: 'register_0', payload }))
    }

    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      const shown = JSON.stringify(msg)
        .replace(/("client-key":")[^"]*"/g, '$1***"')
        .slice(0, 150)
      this._log(`← ${shown}`)

      if (msg.type === 'registered') {
        const k = msg.payload && msg.payload['client-key']
        if (k) {
          this.key_ = String(k)
          try {
            localStorage.setItem(TOKEN_KEY, this.key_)
          } catch {}
        }
        this.registered = true
        this.retries = 0
        this.onStatus('connected', 'Conectado')
        this._request('ssap://com.webos.service.networkinput/getPointerInputSocket', undefined, 'pointer')
        this._request('ssap://com.webos.applicationManager/listLaunchPoints', undefined, 'apps')
      } else if (msg.type === 'response' && msg.id === 'pointer') {
        const path = msg.payload && msg.payload.socketPath
        if (path) this._openPointer(path)
      } else if (msg.type === 'response' && msg.id === 'apps') {
        const list = (msg.payload && msg.payload.launchPoints) || []
        this.apps = list.map((a) => ({ name: a.title, appId: a.id, app_type: a.type || '' }))
        if (this.onApps) this.onApps(this.apps)
      } else if (msg.type === 'error' && msg.id === 'register_0') {
        this.onStatus('error', 'A TV recusou a conexão. Aceite o pedido na TV.')
      }
    }

    ws.onerror = () => {}

    ws.onclose = () => {
      clearTimeout(this.timer)
      if (this.closedByUser || this.ws !== ws) return
      this.registered = false
      if (!opened && this.attempt < this._urls().length - 1) {
        this.attempt += 1
        this._open()
        return
      }
      if (this._retry()) {
        this.onStatus('connecting', 'Reconectando...')
      } else {
        this.onStatus(
          'disconnected',
          opened
            ? 'Desconectado da TV. Toque em Reconectar.'
            : 'Sem resposta da TV. Confira o IP, o Wi-Fi e se a TV está ligada.'
        )
      }
    }
  }

  _openPointer(path) {
    try {
      if (this.pointer) this.pointer.close()
    } catch {}
    this._log('abrindo canal de botões')
    try {
      const p = createSocket(path)
      p.onclose = () => {
        if (this.pointer === p) this.pointer = null
      }
      p.onerror = () => {}
      this.pointer = p
    } catch {
      this.pointer = null
    }
  }

  _retry() {
    if (this.closedByUser || this.retries >= MAX_RETRIES) return false
    this.retries += 1
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      if (this.closedByUser || this.ready) return
      this.attempt = 0
      this._open()
    }, Math.min(1000 * this.retries, 5000))
    return true
  }

  disconnect() {
    this.closedByUser = true
    clearTimeout(this.timer)
    clearTimeout(this.retryTimer)
    for (const s of [this.ws, this.pointer]) {
      try {
        if (s) s.close()
      } catch {}
    }
    this.ws = null
    this.pointer = null
    this.registered = false
  }

  get ready() {
    return !!this.ws && this.ws.readyState === OPEN && this.registered
  }

  _kick() {
    const now = Date.now()
    if (!this.ip || now - this.lastKick < 3000) return
    if (this.ws && this.ws.readyState === CONNECTING) return
    this.lastKick = now
    this.reconnect()
  }

  _request(uri, payload, id) {
    if (!this.ws || this.ws.readyState !== OPEN) return false
    const msg = { type: 'request', id: id || `req_${++this.seq}`, uri }
    if (payload) msg.payload = payload
    this.ws.send(JSON.stringify(msg))
    return true
  }

  key(name) {
    if (!this.ready) {
      this._kick()
      return false
    }
    if (name === 'POWER') {
      // A LG só desliga por aqui; ligar exige Wake-on-LAN (não disponível num app web).
      return this._request('ssap://system/turnOff')
    }
    const b = BUTTONS[name]
    if (!b) return false
    if (!this.pointer || this.pointer.readyState !== OPEN) return false
    this.pointer.send(`type:button\nname:${b}\n\n`)
    return true
  }

  launchApp(name) {
    const ids = APPS[name]
    if (!ids) return false
    if (!this.ready) {
      this._kick()
      return false
    }
    const re = APP_NAMES[name]
    const hit = re && this.apps.find((a) => re.test(a.name || ''))
    const id = hit ? hit.appId : ids[0]
    this._log(`→ abrir ${id}`)
    return this._request('ssap://system.launcher/launch', { id })
  }

  forgetPairing() {
    this.key_ = null
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {}
  }
}
