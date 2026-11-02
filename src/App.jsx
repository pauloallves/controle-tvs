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

export default function App() {
  const [brand, setBrand] = useState(load('tv_brand', DEFAULT_BRAND))
  const [ip, setIp] = useState(load('tv_ip'))
  const [draftIp, setDraftIp] = useState(load('tv_ip'))
  const [status, setStatus] = useState({ s: 'disconnected', m: '' })
  const [showSettings, setShowSettings] = useState(!load('tv_ip'))

  const tvRef = useRef(null)
  const brandRef = useRef(null)
  if (brandRef.current !== brand) {
    if (tvRef.current) tvRef.current.disconnect()
    tvRef.current = createDriver(brand, (s, m) => setStatus({ s, m }))
    brandRef.current = brand
  }
  const tv = tvRef.current

  useEffect(() => {
    if (ip) tv.connect(ip)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && ip && !tv.ready) tv.connect(ip)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
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
        <Btn k="POWER" tv={tv} className="power" label="Ligar/Desligar">
          ⏻
        </Btn>
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

      <div className="apps">
        <button className="app netflix" onClick={() => tv.launchApp('netflix')}>
          Netflix
        </button>
        <button className="app youtube" onClick={() => tv.launchApp('youtube')}>
          YouTube
        </button>
        <button className="app prime" onClick={() => tv.launchApp('prime')}>
          Prime
        </button>
        <button className="app disney" onClick={() => tv.launchApp('disney')}>
          Disney+
        </button>
      </div>

      <div className="dpad">
        <Btn k="UP" tv={tv} repeat className="up">
          ▲
        </Btn>
        <Btn k="LEFT" tv={tv} repeat className="left">
          ◀
        </Btn>
        <Btn k="OK" tv={tv} className="ok">
          OK
        </Btn>
        <Btn k="RIGHT" tv={tv} repeat className="right">
          ▶
        </Btn>
        <Btn k="DOWN" tv={tv} repeat className="down">
          ▼
        </Btn>
      </div>

      <div className="row3">
        <Btn k="BACK" tv={tv}>
          ↩ Voltar
        </Btn>
        <Btn k="HOME" tv={tv}>
          ⌂ Home
        </Btn>
        <Btn k="MENU" tv={tv}>
          ☰ Menu
        </Btn>
      </div>

      <div className="vc">
        <div className="rocker">
          <Btn k="VOL_UP" tv={tv} repeat label="Volume +">
            ＋
          </Btn>
          <span className="cap">VOL</span>
          <Btn k="VOL_DOWN" tv={tv} repeat label="Volume -">
            －
          </Btn>
        </div>
        <div className="mid">
          <Btn k="MUTE" tv={tv} label="Mudo">
            🔇
          </Btn>
          <Btn k="SOURCE" tv={tv} label="Fonte">
            Fonte
          </Btn>
        </div>
        <div className="rocker">
          <Btn k="CH_UP" tv={tv} repeat label="Canal +">
            ＋
          </Btn>
          <span className="cap">CH</span>
          <Btn k="CH_DOWN" tv={tv} repeat label="Canal -">
            －
          </Btn>
        </div>
      </div>

      <div className="media">
        <Btn k="REW" tv={tv}>
          ⏪
        </Btn>
        <Btn k="PLAY" tv={tv}>
          ▶︎
        </Btn>
        <Btn k="PAUSE" tv={tv}>
          ⏸
        </Btn>
        <Btn k="FF" tv={tv}>
          ⏩
        </Btn>
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
    </div>
  )
}
