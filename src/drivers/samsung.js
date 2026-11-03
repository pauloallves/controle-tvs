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
  MORE: 'KEY_MORE', // botão "123": abre o painel de números/cores na tela da TV
  RED: 'KEY_RED',
  GREEN: 'KEY_GREEN',
  YELLOW: 'KEY_YELLOW',
  BLUE: 'KEY_CYAN',
}
for (let i = 0; i <= 9; i++) KEYS[String(i)] = `KEY_${i}`

const APPS = {
  netflix: '11101200001',
  youtube: '111299001912',
  prime: '3201910019365',
  disney: '3201901017640',
  www: '3201907018807',
}

// Nomes usados para achar o app na lista de apps instalados na TV
// (o ID real pode variar por modelo/país, o nome não).
const APP_NAMES = {
  netflix: /netflix/i,
  youtube: /^youtube$/i,
  prime: /prime|amazon/i,
  disney: /disney/i,
  www: /^internet$|samsung internet|navegador|browser|^web/i,
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
    this.apps = []
    this.onApps = null
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
        this._requestApps()
      } else if (msg.event === 'ed.installedApp.get') {
        const list = msg.data && msg.data.data
        if (Array.isArray(list)) {
          this.apps = list
          if (this.onApps) this.onApps(list)
        }
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

  _requestApps() {
    return this._send({
      method: 'ms.channel.emit',
      params: { data: '', event: 'ed.installedApp.get', to: 'host' },
    })
  }

  _launch(appId, actionType) {
    return this._send({
      method: 'ms.channel.emit',
      params: {
        event: 'ed.apps.launch',
        to: 'host',
        data: { action_type: actionType, appId },
      },
    })
  }

  launchApp(name) {
    // 1) usa o ID real que a própria TV informou (lista de apps instalados)
    const re = APP_NAMES[name]
    const found = re && this.apps.find((a) => re.test(String(a.name || '')))
    if (found) {
      const type = Number(found.app_type) === 4 ? 'NATIVE_LAUNCH' : 'DEEP_LINK'
      return this._launch(found.appId, type)
    }
    // 2) sem lista: tenta o ID conhecido nos dois modos de abertura
    const appId = APPS[name]
    if (!appId) return false
    this._requestApps()
    this._launch(appId, 'DEEP_LINK')
    setTimeout(() => this._launch(appId, 'NATIVE_LAUNCH'), 500)
    return true
  }

  forgetPairing() {
    this.token = null
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {}
  }
}
