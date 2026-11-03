import React, { useEffect, useRef, useState } from 'react'
import { BRANDS, DEFAULT_BRAND, createDriver } from './drivers/index.js'

const load = (k, d = '') => {
  try {
    return localStorage.getItem(k) || d
  } catch {
    return d
  }
}
const save = (k, v) => {
  try {
    localStorage.setItem(k, v)
  } catch {}
}

// Botão com repetição ao segurar (volume, setas, canais).
function Btn({ k, tv, repeat, className = '', children, label }) {
  const timer = useRef(null)
  const stop = () => {
    clearInterval(timer.current)
    timer.current = null
  }
  const down = (e) => {
    e.preventDefault()
    tv.key(k)
    if (repeat) {
      stop()
      timer.current = setInterval(() => tv.key(k), 160)
    }
  }
  return (
    <button
      type="button"
      aria-label={label || k}
      className={`btn ${className}`}
      onPointerDown={down}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}

const SourceIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="11" rx="1.5" />
    <path d="M8 19h8M12 16v3M7 9h6M7 12h10" />
  </svg>
)

export default function App() {
  const [brand, setBrand] = useState(load('tv_brand', DEFAULT_BRAND))
  const [ip, setIp] = useState(load('tv_ip'))
  const [draftIp, setDraftIp] = useState(load('tv_ip'))
  const [status, setStatus] = useState({ s: 'disconnected', m: '' })
  const [showSettings, setShowSettings] = useState(!load('tv_ip'))
  const [panel, setPanel] = useState(false)
  const [apps, setApps] = useState([])
  const [logLines, setLogLines] = useState([])
  const [toast, setToast] = useState('')
  const toastUntil = useRef(0)
  const playing = useRef(false)

  const tvRef = useRef(null)
  const brandRef = useRef(null)
  if (brandRef.current !== brand) {
    if (tvRef.current) tvRef.current.disconnect()
    tvRef.current = createDriver(brand, (s, m) => setStatus({ s, m }))
    tvRef.current.onApps = setApps
    tvRef.current.onLog = setLogLines
    brandRef.current = brand
  }
  const tv = tvRef.current

  useEffect(() => {
    if (ip) tv.connect(ip)
    // Ao desbloquear o celular / voltar ao app, o WebSocket costuma estar morto
    // mesmo parecendo aberto. Por isso reconectamos sempre (usa o token salvo,
    // então a TV não pergunta de novo).
    let last = 0
    const wake = () => {
      if (!ip || document.visibilityState === 'hidden') return
      if (Date.now() - last < 1500) return
      last = Date.now()
      tv.reconnect()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('pageshow', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('online', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('pageshow', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('online', wake)
    }
    // eslint-disable-next-line
  }, [ip, brand])

  const saveSettings = () => {
    const v = draftIp.trim()
    if (!v) return
    save('tv_ip', v)
    save('tv_brand', brand)
    setShowSettings(false)
    if (v === ip) tv.connect(v)
    else setIp(v)
  }

  const repair = () => {
    tv.forgetPairing()
    if (ip) tv.connect(ip)
  }

  const playPause = () => {
    playing.current = !playing.current
    tv.key(playing.current ? 'PLAY' : 'PAUSE')
  }

  // Abre um app na TV e mostra por alguns segundos o que foi enviado e o que a TV respondeu.
  const launch = (name) => {
    tv.launchApp(name)
    toastUntil.current = Date.now() + 6000
    setToast(`Enviando: abrir ${name}...`)
    setTimeout(() => {
      if (Date.now() >= toastUntil.current) setToast('')
    }, 6200)
  }
  useEffect(() => {
    if (Date.now() < toastUntil.current && logLines.length) {
      setToast(logLines.slice(-3).join('\n'))
    }
  }, [logLines])

  const brandKeys = Object.keys(BRANDS)
  const connected = status.s === 'connected'

  return (
    <div className="app">
      <header>
        <button className="dot-wrap" onClick={() => setShowSettings(true)}>
          <span className={`dot ${status.s}`} />
          <span className="status">
            {connected ? 'Conectado' : status.m || 'Desconectado'}
          </span>
        </button>
        {!connected && ip && (
          <button className="reconnect" onClick={() => tv.reconnect()}>
            Reconectar
          </button>
        )}
      </header>

      {showSettings && (
        <div className="sheet">
          <h2>Configurar TV</h2>

          {brandKeys.length > 1 && (
            <>
              <label>Marca</label>
              <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                {brandKeys.map((b) => (
                  <option key={b} value={b}>
                    {BRANDS[b].label}
                  </option>
                ))}
              </select>
            </>
          )}

          <label>IP da TV (ex.: 192.168.0.25)</label>
          <input
            inputMode="decimal"
            value={draftIp}
            onChange={(e) => setDraftIp(e.target.value.replace(/,/g, '.').replace(/\s/g, ''))}
            placeholder="192.168.0.25"
          />
          <p className="hint">
            Na TV: Configurações → Geral → Rede → Status da rede → Configurações
            de IP.
          </p>
          <div className="row">
            <button className="primary" onClick={saveSettings}>
              Salvar e conectar
            </button>
            <button onClick={repair}>Refazer pareamento</button>
          </div>
          <details className="diag">
            <summary>Diagnóstico: {apps.length} apps encontrados na TV</summary>
            {apps.length === 0 ? (
              <p className="hint">
                A TV ainda não enviou a lista de apps (conecte primeiro).
              </p>
            ) : (
              <ul>
                {apps.map((a, i) => (
                  <li key={i}>
                    {a.name} — {a.appId} (tipo {String(a.app_type)})
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">Últimas mensagens com a TV:</p>
            <pre>{logLines.length ? logLines.join('\n') : '(nenhuma ainda)'}</pre>
          </details>
          {ip && (
            <button className="link" onClick={() => setShowSettings(false)}>
              Fechar
            </button>
          )}
          <p className="hint">
            Se a conexão falhar, abra uma vez{' '}
            <b>https://{draftIp || 'IP-DA-TV'}:8002</b> no navegador, aceite o
            aviso de certificado e volte aqui.
          </p>
        </div>
      )}

      <div className="remote">
        <div className="r-power">
          <Btn k="POWER" tv={tv} className="rbtn power" label="Ligar/Desligar">
            ⏻
          </Btn>
        </div>

        <div className="r-top">
          <Btn k="MORE" tv={tv} className="rbtn colors" label="123 (números e cores na TV)">
            <span className="dots">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="t123">123</span>
          </Btn>
          <Btn k="SOURCE" tv={tv} className="rbtn" label="Fonte">
            <SourceIcon />
          </Btn>
        </div>

        <div className="ring">
          <Btn k="UP" tv={tv} repeat className="zone up" label="Cima">
            <span>⌃</span>
          </Btn>
          <Btn k="RIGHT" tv={tv} repeat className="zone right" label="Direita">
            <span>›</span>
          </Btn>
          <Btn k="DOWN" tv={tv} repeat className="zone down" label="Baixo">
            <span>⌄</span>
          </Btn>
          <Btn k="LEFT" tv={tv} repeat className="zone left" label="Esquerda">
            <span>‹</span>
          </Btn>
          <Btn k="OK" tv={tv} className="ok" label="OK">
            OK
          </Btn>
        </div>

        <div className="r-mid">
          <Btn k="BACK" tv={tv} className="rbtn" label="Voltar">
            ↩
          </Btn>
          <Btn k="HOME" tv={tv} className="rbtn" label="Home">
            ⌂
          </Btn>
          <button
            type="button"
            className="btn rbtn"
            aria-label="Play/Pause"
            onClick={playPause}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
              <path d="M3 5l8 7-8 7z" />
              <rect x="14" y="5" width="3" height="14" rx="1" />
              <rect x="19" y="5" width="3" height="14" rx="1" />
            </svg>
          </button>
        </div>

        <div className="r-vc">
          <div className="rocker">
            <Btn k="VOL_UP" tv={tv} repeat label="Volume +">
              ＋
            </Btn>
            <span className="cap">VOL</span>
            <Btn k="VOL_DOWN" tv={tv} repeat label="Volume -">
              －
            </Btn>
          </div>
          <div className="mute">
            <Btn k="MUTE" tv={tv} className="rbtn small" label="Mudo">
              🔇
            </Btn>
          </div>
          <div className="rocker">
            <Btn k="CH_UP" tv={tv} repeat label="Canal +">
              ⌃
            </Btn>
            <span className="cap">CH</span>
            <Btn k="CH_DOWN" tv={tv} repeat label="Canal -">
              ⌄
            </Btn>
          </div>
        </div>

        <div className="r-apps">
          <button className="btn appbtn netflix" onClick={() => launch('netflix')}>
            NETFLIX
          </button>
          <button className="btn appbtn prime" onClick={() => launch('prime')}>
            prime video
          </button>
          <button className="btn appbtn www" onClick={() => launch('www')}>
            WWW
          </button>
        </div>

        <div className="brand">SAMSUNG</div>
      </div>

      <button type="button" className="morekeys" onClick={() => setPanel(true)}>
        ▴ Números e mais teclas
      </button>

      {toast && <div className="toast">{toast}</div>}

      {panel && (
        <div className="drawer-bg" onClick={() => setPanel(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="grab" onClick={() => setPanel(false)} />

            <div className="colorkeys">
              <Btn k="RED" tv={tv} className="ck red" label="Vermelho" />
              <Btn k="GREEN" tv={tv} className="ck green" label="Verde" />
              <Btn k="YELLOW" tv={tv} className="ck yellow" label="Amarelo" />
              <Btn k="BLUE" tv={tv} className="ck blue" label="Azul" />
            </div>

            <div className="numpad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
                <Btn key={n} k={n} tv={tv}>
                  {n}
                </Btn>
              ))}
              <Btn k="GUIDE" tv={tv} className="small">
                Guia
              </Btn>
              <Btn k="0" tv={tv}>
                0
              </Btn>
              <Btn k="INFO" tv={tv} className="small">
                Info
              </Btn>
            </div>

            <div className="media">
              <Btn k="REW" tv={tv} label="Retroceder">
                ⏪
              </Btn>
              <Btn k="PLAY" tv={tv} label="Play">
                ▶︎
              </Btn>
              <Btn k="PAUSE" tv={tv} label="Pause">
                ⏸
              </Btn>
              <Btn k="FF" tv={tv} label="Avançar">
                ⏩
              </Btn>
            </div>

            <div className="extra">
              <Btn k="MENU" tv={tv} className="small">
                ☰ Menu
              </Btn>
              <button className="btn small youtube" onClick={() => launch('youtube')}>
                YouTube
              </button>
              <button className="btn small disney" onClick={() => launch('disney')}>
                Disney+
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
