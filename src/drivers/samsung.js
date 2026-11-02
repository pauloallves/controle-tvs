// Driver Samsung Tizen (ex.: AU8000, 2021).
// Protocolo: wss://IP:8002/api/v2/channels/samsung.remote.control?name=BASE64&token=TOKEN
//
// Contrato que todo driver deve seguir (ver drivers/index.js):
//   constructor(onStatus)        onStatus(estado, mensagem)
//   connect(ip)                  estados: connecting | auth | connected | error | disconnected
//   disconnect()
//   get ready                    true quando dá para enviar comandos
//   key(nome)                    nome do vocabulário universal (UP, VOL_UP, 5...)
//   launchApp(nome)              netflix | youtube | prime | disney
//   forgetPairing()              apaga o token salvo

const APP_NAME = 'Controle TV'
const TOKEN_KEY = 'tv_token_samsung'

const b64 = (s) => btoa(unescape(encodeURIComponent(s)))

const KEYS = {
  UP: 'KEY_UP',
  DOWN: 'KEY_DOWN',
  LEFT: 'KEY_LEFT',
  RIGHT: 'KEY_RIGHT',
  OK: 'KEY_ENTER',
  BACK: 'KEY_RETURN',
  HOME: 'KEY_HOME',
  MENU: 'KEY_MENU',
  POWER: 'KEY_POWER',
  VOL_UP: 'KEY_VOLUP',
  VOL_DOWN: 'KEY_VOLDOWN',
  MUTE: 'KEY_MUTE',
  CH_UP: 'KEY_CHUP',
  CH_DOWN: 'KEY_CHDOWN',
  SOURCE: 'KEY_SOURCE',
  PLAY: 'KEY_PLAY',
  PAUSE: 'KEY_PAUSE',
  REW: 'KEY_REWIND',
  FF: 'KEY_FF',
  GUIDE: 'KEY_GUIDE',
  INFO: 'KEY_INFO',
}
for (let i = 0; i <= 9; i++) KEYS[String(i)] = `KEY_${i}`

const APPS = {
  netflix: '11101200001',
  youtube: '111299001912',
  prime: '3201910019365',
  disney: '3201901017640',
}

const load = (k) => {
  try {
    return localStorage.getItem(k) || null
  } catch {
    return null
  }
}

export class SamsungDriver {
  constructor(onStatus) {
    this.onStatus = onStatus
    this.ws = null
    this.ip = null
    this.token = load(TOKEN_KEY)
    this.tryPort = 8002
    this.closedByUser = false
    this.timer = null
  }

  connect(ip) {
    this.disconnect()
    this.closedByUser = false
    this.ip = ip
    this.token = load(TOKEN_KEY)
    this.tryPort = 8002
    this._open()
  }

  _open() {
    const secure = this.tryPort === 8002
    const proto = secure ? 'wss' : 'ws'
    let url = `${proto}://${this.ip}:${this.tryPort}/api/v2/channels/samsung.remote.control?name=${b64(APP_NAME)}`
    if (this.token) url += `&token=${this.token}`

    this.onStatus('connecting', `Conectando (${this.tryPort})...`)

    let ws
    try {
      ws = new WebSocket(url)
    } catch (e) {
      this.onStatus('error', 'Não foi possível abrir a conexão.')
      return
    }
    this.ws = ws

    // Se a TV não responder em 8s, tenta a outra porta.
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (this.ws === ws && ws.readyState !== WebSocket.OPEN) ws.close()
    }, 8000)

    let opened = false

    ws.onopen = () => {
      opened = true
      clearTimeout(this.timer)
      this.onStatus('auth', 'Aceite a conexão na TV (pop-up na tela).')
    }

    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.event === 'ms.channel.connect') {
        const t = msg.data && msg.data.token
        if (t) {
          this.token = String(t)
          try {
            localStorage.setItem(TOKEN_KEY, this.token)
          } catch {}
        }
        this.onStatus('connected', 'Conectado')
      } else if (msg.event === 'ms.channel.unauthorized') {
        this.onStatus('error', 'A TV recusou a conexão. Aceite o pedido na TV.')
      } else if (msg.event === 'ms.channel.timeOut') {
        this.onStatus('error', 'Tempo esgotado esperando a autorização na TV.')
      }
    }

    ws.onerror = () => {}

    ws.onclose = () => {
      clearTimeout(this.timer)
      if (this.closedByUser || this.ws !== ws) return
      if (!opened && this.tryPort === 8002) {
        this.tryPort = 8001 // fallback para modelos antigos
        this._open()
        return
      }
      this.onStatus(
        'disconnected',
        opened
          ? 'Desconectado da TV.'
          : 'Sem resposta da TV. Confira o IP, o Wi-Fi e se a TV está ligada.'
      )
    }
  }

  disconnect() {
    this.closedByUser = true
    clearTimeout(this.timer)
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
    }
    this.ws = null
  }

  get ready() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  _send(obj) {
    if (!this.ready) return false
    this.ws.send(JSON.stringify(obj))
    return true
  }

  key(name) {
    const code = KEYS[name]
    if (!code) return false
    return this._send({
      method: 'ms.remote.control',
      params: {
        Cmd: 'Click',
        DataOfCmd: code,
        Option: 'false',
        TypeOfRemote: 'SendRemoteKey',
      },
    })
  }

  launchApp(name) {
    const appId = APPS[name]
    if (!appId) return false
    return this._send({
      method: 'ms.channel.emit',
      params: {
        event: 'ed.apps.launch',
        to: 'host',
        data: { action_type: 'DEEP_LINK', appId },
      },
    })
  }

  forgetPairing() {
    this.token = null
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {}
  }
}
