import React, { useEffect, useRef, useState } from 'react'
import { BRANDS, DEFAULT_BRAND, createDriver } from './drivers/index.js'
import { isNative } from './transport.js'

// Data/hash do build (definido no vite.config.js): mostra qual versão está instalada.
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev'

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

// Ícone desenhado (o caractere ⏻ aparece errado em vários Androids).
const PowerIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v8" />
    <path d="M7.05 6.6a8 8 0 1 0 9.9 0" />
  </svg>
)

const MicIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
  </svg>
)

export default function App() {
  const [brand, setBrand] = useState(load('tv_brand', DEFAULT_BRAND))
  const [model, setModel] = useState(load('tv_model'))
  const [appFilter, setAppFilter] = useState('')
  const [testId, setTestId] = useState('')
  const [ip, setIp] = useState(load('tv_ip'))
  const [draftIp, setDraftIp] = useState(load('tv_ip'))
  const [status, setStatus] = useState({ s: 'disconnected', m: '' })
  const [showSettings, setShowSettings] = useState(!load('tv_ip'))
  const [panel, setPanel] = useState(false)
  const [apps, setApps] = useState([])
  const [logLines, setLogLines] = useState([])
  const [toast, setToast] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanDone, setScanDone] = useState(false)
  const [found, setFound] = useState([])
  const [dictate, setDictate] = useState(false)
  const [dictText, setDictText] = useState('')
  const recRef = useRef(null)
  const [recording, setRecording] = useState(false)
  const [macro, setMacro] = useState(() => {
    try {
      const v = JSON.parse(load('macro_globo', 'null'))
      return Array.isArray(v) && v.length ? v : null
    } catch {
      return null
    }
  })
  const toastOn = useRef(false)
  const toastTimer = useRef(null)
  const playing = useRef(false)

  const tvRef = useRef(null)
  const brandRef = useRef(null)
  if (brandRef.current !== brand) {
    if (tvRef.current) tvRef.current.disconnect()
    tvRef.current = createDriver(brand, (s, m) => setStatus({ s, m }))
    // Grava as teclas enviadas enquanto o usuário "ensina" um atalho (ver startRec).
    const d = tvRef.current
    const sendKey = d.key.bind(d)
    d.rawKey = sendKey
    d.key = (n) => {
      if (recRef.current) recRef.current.push(n)
      return sendKey(n)
    }
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

  // Trocar de marca zera o modelo para o padrão da nova marca; só vale depois de "Salvar".
  const defaultModel = (b) => (BRANDS[b].models && BRANDS[b].models[0].id) || ''
  const model_ = (BRANDS[brand].models || []).some((m) => m.id === model) ? model : defaultModel(brand)
  const changeBrand = (b) => {
    setBrand(b)
    setModel(defaultModel(b))
    setFound([])
    setScanDone(false)
  }
  const changeModel = (m) => setModel(m)

  const saveSettings = (address) => {
    const v = (typeof address === 'string' ? address : draftIp).trim()
    if (!v) return
    save('tv_ip', v)
    save('tv_brand', brand)
    save('tv_model', model_)
    setDraftIp(v)
    setShowSettings(false)
    if (v === ip) tv.connect(v)
    else setIp(v)
  }

  // Busca automática da TV (só existe no app Android).
  const canScan = isNative() && !!(BRANDS[brand] && BRANDS[brand].discover)
  const scan = async () => {
    if (!canScan || scanning) return
    setScanning(true)
    setScanDone(false)
    setFound([])
    try {
      const list = await BRANDS[brand].discover()
      setFound(list)
      // Primeira vez e só uma TV na rede: conecta direto, sem digitar nada.
      if (list.length === 1 && !ip) saveSettings(list[0].ip)
    } catch {
      setFound([])
    }
    setScanning(false)
    setScanDone(true)
  }
  useEffect(() => {
    if (showSettings && !ip && canScan) scan()
    // eslint-disable-next-line
  }, [])

  const repair = () => {
    tv.forgetPairing()
    if (ip) tv.connect(ip)
  }

  const playPause = () => {
    playing.current = !playing.current
    tv.key(playing.current ? 'PLAY' : 'PAUSE')
  }

  // Abre um app na TV e mostra o que foi enviado e o que a TV respondeu.
  // O aviso fica no topo (não cobre os botões) e some 25 s depois da última mensagem,
  // ou antes, pelo ✕. Dá tempo de ler/tirar print.
  const closeToast = () => {
    toastOn.current = false
    clearTimeout(toastTimer.current)
    setToast('')
  }
  const armToast = () => {
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(closeToast, 25000)
  }
  // Atalho ensinado: reproduz as teclas gravadas (HOME, setas..., OK) com pausas.
  // Serve para apps cujo ID a TV não revela (ex.: Globoplay na AU8000).
  const startRec = () => {
    recRef.current = []
    setPanel(false)
    setRecording(true)
  }
  const cancelRec = () => {
    recRef.current = null
    setRecording(false)
  }
  const finishRec = () => {
    const seq = recRef.current || []
    recRef.current = null
    setRecording(false)
    if (seq.length >= 2) {
      save('macro_globo', JSON.stringify(seq))
      setMacro(seq)
    }
  }
  const clearMacro = () => {
    save('macro_globo', 'null')
    setMacro(null)
  }
  const playMacro = (seq) => {
    const keys = seq[0] === 'HOME' ? seq : ['HOME', ...seq]
    let t = 0
    keys.forEach((k, i) => {
      setTimeout(() => tv.rawKey(k), t)
      t += i === 0 ? 1800 : 450
    })
  }

  const launch = (name, customId) => {
    if (name === 'globo' && macro) {
      playMacro(macro)
      toastOn.current = false
      setToast('Abrindo o Globoplay pelo atalho gravado...')
      armToast()
      return
    }
    if (name === 'custom') tv.launchId(customId)
    else tv.launchApp(name)
    toastOn.current = true
    setToast(`Enviando: abrir ${name}...`)
    armToast()
  }
  useEffect(() => {
    if (toastOn.current && logLines.length) {
      setToast(logLines.slice(-10).join('\n'))
      armToast()
    }
    // eslint-disable-next-line
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

          <label>Marca da TV</label>
          <select value={brand} onChange={(e) => changeBrand(e.target.value)}>
            {brandKeys.map((b) => (
              <option key={b} value={b}>
                {BRANDS[b].label}
              </option>
            ))}
          </select>
          {BRANDS[brand].models && (
            <>
              <label>Ano / modelo</label>
              <select value={model} onChange={(e) => changeModel(e.target.value)}>
                {BRANDS[brand].models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </>
          )}
          {BRANDS[brand].note && <p className="hint">{BRANDS[brand].note}</p>}

          {canScan && (
            <>
              <button className="primary" onClick={scan} disabled={scanning}>
                {scanning ? 'Procurando TV na rede...' : 'Buscar TV na rede'}
              </button>
              {found.map((t) => (
                <button key={t.ip} onClick={() => saveSettings(t.ip)}>
                  {t.name} — {t.ip}
                  {t.model ? ` (${t.model})` : ''}
                </button>
              ))}
              {scanDone && found.length === 0 && (
                <p className="hint">
                  Nenhuma TV encontrada. Confira se a TV está ligada e no mesmo
                  Wi-Fi do celular, ou digite o IP abaixo.
                </p>
              )}
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
            <button className="primary" onClick={() => saveSettings()}>
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
              <>
                <input
                  value={appFilter}
                  onChange={(e) => setAppFilter(e.target.value)}
                  placeholder="Filtrar apps (ex.: globo)"
                />
                <ul>
                  {apps
                    .filter((a) =>
                      `${a.name} ${a.appId}`.toLowerCase().includes(appFilter.trim().toLowerCase())
                    )
                    .map((a, i) => (
                      <li key={i}>
                        {a.name} — {a.appId} (tipo {String(a.app_type)})
                      </li>
                    ))}
                </ul>
              </>
            )}
            <p className="hint">Testar um ID de app:</p>
            <div className="row">
              <input
                value={testId}
                onChange={(e) => setTestId(e.target.value.replace(/\s/g, ''))}
                placeholder="ex.: 3201908019022"
              />
              <button onClick={() => testId && launch('custom', testId)}>Abrir</button>
            </div>
            <p className="hint">Últimas mensagens com a TV:</p>
            <pre>{logLines.length ? logLines.join('\n') : '(nenhuma ainda)'}</pre>
          </details>
          <p className="hint">Versão do app: {BUILD}</p>
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
            <PowerIcon />
          </Btn>
        </div>

        <div className="r-top">
          <Btn k="MORE" tv={tv} className="rbtn" label="123 (números na TV)">
            <span className="t123">123</span>
          </Btn>
          <button
            type="button"
            className="btn rbtn"
            aria-label="Microfone (abre a Alexa)"
            onClick={() => (brand === 'samsung' ? launch('alexa') : setDictate(true))}
          >
            <MicIcon />
          </button>
          <button
            type="button"
            className="btn rbtn colors"
            aria-label="Teclas coloridas e números"
            onClick={() => setPanel(true)}
          >
            <span className="dots">
              <i />
              <i />
              <i />
              <i />
            </span>
          </button>
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
          <button className="btn appbtn globo" onClick={() => launch('globo')}>
            globoplay
          </button>
        </div>

        <div className="brand">{BRANDS[brand].label.split(' ')[0].toUpperCase()}</div>
      </div>

      <button type="button" className="morekeys" onClick={() => setPanel(true)}>
        ▴ Números e mais teclas
      </button>

      {dictate && (
        <div className="drawer-bg" onClick={() => setDictate(false)}>
          <div className="drawer dictate" onClick={(e) => e.stopPropagation()}>
            <div className="grab" onClick={() => setDictate(false)} />
            <p className="hint">
              Abra a busca na TV (ex.: lupa do YouTube ou do Globoplay), toque no campo abaixo e use o
              <b> microfone do teclado do celular</b> para falar. Depois toque em Enviar.
            </p>
            <textarea
              rows={3}
              value={dictText}
              onChange={(e) => setDictText(e.target.value)}
              placeholder="Fale ou digite aqui..."
            />
            <div className="row">
              <button
                className="primary"
                onClick={() => {
                  if (dictText.trim()) tv.sendText(dictText.trim())
                }}
              >
                Enviar para a TV
              </button>
              <button
                onClick={() => {
                  if (!dictText.trim()) return
                  tv.sendText(dictText.trim())
                  setTimeout(() => tv.key('OK'), 500)
                }}
              >
                Enviar e buscar
              </button>
            </div>
            <div className="row">
              <button onClick={() => setDictText('')}>Limpar</button>
              <button onClick={() => setDictate(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {recording && (
        <div className="recbar">
          <p>
            <b>Gravando atalho do Globoplay.</b> Aperte HOME, leve a seleção até o Globoplay com as
            setas e aperte OK. Depois toque em Concluir.
          </p>
          <div className="row">
            <button className="primary" onClick={finishRec}>
              Concluir
            </button>
            <button onClick={cancelRec}>Cancelar</button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast">
          <button type="button" className="toast-x" onClick={closeToast} aria-label="Fechar aviso">
            ✕
          </button>
          {toast}
        </div>
      )}

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
              <Btn k="SOURCE" tv={tv} className="small">
                Fonte
              </Btn>
              <button className="btn small" onClick={() => launch('www')}>
                Navegador
              </button>
              <button
                className="btn small"
                onClick={() => {
                  setPanel(false)
                  setDictate(true)
                }}
              >
                Ditar texto
              </button>
              <button className="btn small" onClick={startRec}>
                {macro ? 'Regravar Globo' : 'Ensinar Globo'}
              </button>
              {macro && (
                <button className="btn small" onClick={clearMacro}>
                  Apagar atalho
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
