// Driver Samsung Tizen (ex.: AU8000, 2021).
// Protocolo: wss://IP:8002/api/v2/channels/samsung.remote.control?name=BASE64&token=TOKEN
//
// Contrato que todo driver deve seguir (ver drivers/index.js):
//   constructor(onStatus)        onStatus(estado, mensagem)
//   connect(ip)                  estados: connecting | auth | connected | error | disconnected
//   reconnect()                  reabre a conexão com o último IP
//   disconnect()
//   get ready                    true quando dá para enviar comandos
//   key(nome)                    nome do vocabulário universal (UP, VOL_UP, 5...)
//   launchApp(nome)              netflix | youtube | prime | disney | www
//   forgetPairing()              apaga o token salvo
//   onApps / onLog               callbacks opcionais (lista de apps e log de diagnóstico)

import { createSocket, OPEN, CONNECTING, discoverSamsungTvs, isNative, rest } from '../transport.js'

const APP_NAME = 'Controle TV'
const TOKEN_KEY = 'tv_token_samsung'

// Busca automática (só funciona no app Android; no navegador devolve lista vazia).
export const discover = discoverSamsungTvs

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
  WLINK: 'KEY_W_LINK',
  RED: 'KEY_RED',
  GREEN: 'KEY_GREEN',
  YELLOW: 'KEY_YELLOW',
  BLUE: 'KEY_CYAN',
}
for (let i = 0; i <= 9; i++) KEYS[String(i)] = `KEY_${i}`

// IDs conhecidos (TVs 2019+). O primeiro da lista é o preferido.
// O Netflix antigo (Tizen < 2019) usava 11101200001.
const APPS = {
  netflix: { ids: ['3201907018807', '11101200001'], type: 'DEEP_LINK' },
  youtube: { ids: ['111299001912'], type: 'DEEP_LINK' },
  prime: { ids: ['3201910019365', '3201910019354'], type: 'DEEP_LINK' },
  disney: { ids: ['3201901017640'], type: 'DEEP_LINK' },
  // org.tizen.browser é o ID documentado do navegador, mas a API HTTP da AU8000
  // respondeu 404 para ele; os outros dois são palpites de teste (aparecem no log).
  www: { ids: ['org.tizen.browser', 'webbrowser', 'Internet'], type: 'NATIVE_LAUNCH', meta: 'https://www.google.com' },
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

const MAX_RETRIES = 6

export class SamsungDriver {
  constructor(onStatus) {
    this.onStatus = onStatus
    this.ws = null
    this.ip = null
    this.token = load(TOKEN_KEY)
    this.tryPort = 8002
    this.closedByUser = false
    this.timer = null
    this.retryTimer = null
    this.retries = 0
    this.lastKick = 0
    this.apps = []
    this.onApps = null
    this.onLog = null
    this.logLines = []
  }

  _log(line) {
    const t = new Date().toTimeString().slice(0, 8)
    this.logLines = [...this.logLines, `${t} ${line}`].slice(-14)
    if (this.onLog) this.onLog(this.logLines)
  }

  connect(ip) {
    this.disconnect()
    this.closedByUser = false
    this.ip = ip
    this.token = load(TOKEN_KEY)
    this.tryPort = 8002
    this.retries = 0
    this._open()
  }

  reconnect() {
    if (this.ip) this.connect(this.ip)
  }

  _open() {
    const secure = this.tryPort === 8002
    const proto = secure ? 'wss' : 'ws'
    let url = `${proto}://${this.ip}:${this.tryPort}/api/v2/channels/samsung.remote.control?name=${b64(APP_NAME)}`
    if (this.token) url += `&token=${this.token}`

    this.onStatus('connecting', `Conectando (${this.tryPort})...`)
    this._log(`abrindo ${proto}:${this.tryPort}`)

    let ws
    try {
      ws = createSocket(url)
    } catch (e) {
      this.onStatus('error', 'Não foi possível abrir a conexão.')
      return
    }
    this.ws = ws

    // Se a TV não responder em 8s, tenta a outra porta.
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (this.ws === ws && ws.readyState !== OPEN) ws.close()
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
      if (msg.event === 'ed.installedApp.get') {
        const list = msg.data && msg.data.data
        this._log(`← apps instalados: ${Array.isArray(list) ? list.length : '?'}`)
        if (Array.isArray(list)) {
          this.apps = list
          if (this.onApps) this.onApps(list)
        }
        return
      }
      this._log(`← ${JSON.stringify(msg).slice(0, 150)}`)
      if (msg.event === 'ms.channel.connect') {
        const t = msg.data && msg.data.token
        if (t) {
          this.token = String(t)
          try {
            localStorage.setItem(TOKEN_KEY, this.token)
          } catch {}
        }
        this.retries = 0
        this.onStatus('connected', 'Conectado')
        this._requestApps()
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
      const retrying = this._retry()
      if (retrying) {
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

  // Tenta reabrir sozinho (celular bloqueado/desbloqueado, Wi-Fi oscilando).
  _retry() {
    if (this.closedByUser || this.retries >= MAX_RETRIES) return false
    this.retries += 1
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      if (this.closedByUser || this.ready) return
      this.tryPort = 8002
      this._open()
    }, Math.min(1000 * this.retries, 5000))
    return true
  }

  disconnect() {
    this.closedByUser = true
    clearTimeout(this.timer)
    clearTimeout(this.retryTimer)
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
    }
    this.ws = null
  }

  get ready() {
    return !!this.ws && this.ws.readyState === OPEN
  }

  // Se o usuário tocar num botão com a conexão caída, reconecta sozinho.
  _kick() {
    const now = Date.now()
    if (!this.ip || now - this.lastKick < 3000) return
    if (this.ws && this.ws.readyState === CONNECTING) return
    this.lastKick = now
    this.reconnect()
  }

  _send(obj) {
    if (!this.ready) {
      this._kick()
      return false
    }
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
    this._log('→ pedir lista de apps')
    return this._send({
      method: 'ms.channel.emit',
      params: { data: '', event: 'ed.installedApp.get', to: 'host' },
    })
  }

  _launch(appId, actionType, meta) {
    this._log(`→ abrir ${appId} (${actionType})`)
    // metaTag sempre presente (mesmo vazio): algumas versões da TV exigem o campo
    const data = { action_type: actionType, appId, metaTag: meta || '' }
    return this._send({
      method: 'ms.channel.emit',
      params: { event: 'ed.apps.launch', to: 'host', data },
    })
  }

  launchApp(name) {
    if (!APPS[name]) return false
    if (!this.ready) return this._send({})
    // No app Android, tenta primeiro a API HTTP da TV (REST); se não der, usa o WebSocket.
    if (isNative()) {
      this._launchRest(name)
      return true
    }
    // No navegador/PWA (ex.: iPhone) a resposta da TV não é legível, mas um POST
    // "simples" (no-cors) ainda é enviado. Dispara junto com o WebSocket.
    this._launchWebRest(name)
    return this._launchWs(name)
  }

  async _launchWebRest(name) {
    const def = APPS[name]
    for (const id of def.ids) {
      try {
        await fetch(`https://${this.ip}:8002/api/v2/applications/${encodeURIComponent(id)}`, {
          method: 'POST',
          mode: 'no-cors',
        })
        this._log(`REST POST ${id}: enviado (resposta não legível no navegador)`)
      } catch (e) {
        this._log(`REST POST ${id}: falhou (${(e && e.message) || e})`)
      }
    }
  }

  // Uma nova tentativa se a TV devolver uma resposta HTTP quebrada.
  async _rest(method, url) {
    let r = await rest(method, url)
    if (r.status === -1 && /Unexpected status line/i.test(String(r.body))) {
      r = await rest(method, url)
    }
    return r
  }

  async _launchRest(name) {
    const def = APPS[name]
    const re = APP_NAMES[name]
    const found = re && this.apps.find((a) => re.test(String(a.name || '')))
    const ids = found ? [String(found.appId)] : def.ids
    const short = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 70)
    for (const id of ids) {
      const url = `http://${this.ip}:8001/api/v2/applications/${encodeURIComponent(id)}`
      const info = await this._rest('GET', url)
      this._log(`REST GET ${id}: ${info.status} ${short(info.body)}`)
      if (info.status === 200) {
        const run = await this._rest('POST', url)
        // A TV costuma devolver uma resposta cortada ("HTTP/") mesmo quando aceita; só o status importa.
        const accepted = run.status >= 200 && run.status < 300
        this._log(`REST POST ${id}: ${run.status} ${accepted ? 'ok, a TV aceitou' : short(run.body)}`)
        if (run.status >= 200 && run.status < 300) return
      } else if (info.status === -1) {
        break // porta 8001 inacessível: nem adianta tentar os outros IDs
      }
    }
    this._log('REST sem sucesso, tentando pelo WebSocket')
    this._launchWs(name)
  }

  _launchWs(name) {
    const def = APPS[name]
    if (!def) return false

    // 1) usa o ID real que a própria TV informou (lista de apps instalados)
    const re = APP_NAMES[name]
    const found = re && this.apps.find((a) => re.test(String(a.name || '')))
    if (found) {
      // app_type 2 = app web (DEEP_LINK); os demais (ex.: nativos) = NATIVE_LAUNCH
      const type = Number(found.app_type) === 2 ? 'DEEP_LINK' : 'NATIVE_LAUNCH'
      this._log(`lista da TV: ${found.name} id=${found.appId} tipo=${found.app_type}`)
      return this._launch(found.appId, type, def.meta)
    }

    // 2) sem lista: tenta cada ID conhecido, no modo certo e depois no outro
    const other = def.type === 'DEEP_LINK' ? 'NATIVE_LAUNCH' : 'DEEP_LINK'
    let delay = 0
    for (const id of def.ids) {
      setTimeout(() => this._launch(id, def.type, def.meta), delay)
      delay += 600
    }
    setTimeout(() => this._launch(def.ids[0], other, def.meta), delay)
    // Último recurso só para o navegador: tecla "W.LINK" (da lista de teclas da Samsung;
    // não há ID/tecla confirmado para o navegador na AU8000, então é um teste).
    if (name === 'www') {
      setTimeout(() => {
        this._log('→ teste: tecla KEY_W_LINK')
        this.key('WLINK')
      }, delay + 800)
    }
    return true
  }

  forgetPairing() {
    this.token = null
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {}
  }
}
