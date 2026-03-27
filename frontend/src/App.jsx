import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const WS_URL = import.meta.env.VITE_WS_URL || `${window.location.protocol}//${window.location.hostname}:3000`
const socket = io(WS_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10,
})

function App() {
  const [status, setStatus] = useState('connecting')
  const [messages, setMessages] = useState([])
  const [value, setValue] = useState('')
  const [peers, setPeers] = useState([])
  const [target, setTarget] = useState('')
  const [myId, setMyId] = useState('')
  const [nameInput, setNameInput] = useState(() => localStorage.getItem('chatName') || '')
  const [name, setName] = useState(() => localStorage.getItem('chatName') || '')
  const nameRef = useRef(name)

  useEffect(() => {
    function handleConnect() {
      setStatus('connected')
      setMyId(socket.id)
      setMessages((prev) => [...prev, { from: 'system', text: `Connected as ${nameRef.current || socket.id}` }])
    }

    function handleDisconnect(reason) {
      setStatus('disconnected')
      setMessages((prev) => [...prev, { from: 'system', text: `Disconnected: ${reason}` }])
    }

    function handleMessage(payload) {
      const text = payload?.text || JSON.stringify(payload)
      const fromId = payload?.from
      const toId = payload?.to
      const fromName =
        payload?.fromName || (fromId === socket.id ? nameRef.current || 'You' : fromId) || 'peer'
      const toName = payload?.toName || toId || ''
      setMessages((prev) => [
        ...prev,
        { from: fromName, fromId, to: toId, toName, text, own: fromId === socket.id },
      ])
    }

    function handleOnline(list = []) {
      const peersOnly = list.filter((item) => item.id !== socket.id)
      setPeers(peersOnly)
      const hasTarget = peersOnly.some((p) => p.id === target)
      if (!hasTarget) {
        setTarget(peersOnly[0]?.id || '')
      }
    }

    function handleWelcome(payload = {}) {
      if (payload.id) setMyId(payload.id)
      if (Array.isArray(payload.online)) {
        const peersOnly = payload.online.filter((item) => item.id !== socket.id)
        setPeers(peersOnly)
        const hasTarget = peersOnly.some((p) => p.id === target)
        if (!hasTarget) {
          setTarget(peersOnly[0]?.id || '')
        }
      }
    }

    function handleConnectError(err) {
      console.error('Socket connect error', err?.message)
      setStatus('error')
      setMessages((prev) => [...prev, { from: 'system', text: `Connect error: ${err?.message || 'unknown'}` }])
    }

    function handleReconnectAttempt(attempt) {
      setStatus('connecting')
      if (attempt > 1) {
        setMessages((prev) => [...prev, { from: 'system', text: `Reconnecting... (attempt ${attempt})` }])
      }
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('message', handleMessage)
    socket.on('online', handleOnline)
    socket.on('welcome', handleWelcome)
    socket.on('connect_error', handleConnectError)
    socket.on('reconnect_attempt', handleReconnectAttempt)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('message', handleMessage)
      socket.off('online', handleOnline)
      socket.off('welcome', handleWelcome)
      socket.off('connect_error', handleConnectError)
      socket.off('reconnect_attempt', handleReconnectAttempt)
      socket.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!name) return
    socket.auth = { name }
    if (!socket.connected) {
      setStatus('connecting')
      socket.connect()
    }
  }, [name])

  useEffect(() => {
    nameRef.current = name
  }, [name])

  const resolveName = (id) => {
    if (!id) return ''
    if (id === socket.id) return name || 'You'
    return peers.find((p) => p.id === id)?.name || id
  }

  function sendMessage() {
    const trimmed = value.trim()
    if (!trimmed || !target) return
    socket.emit('direct-message', { to: target, text: trimmed })
    setMessages((prev) => [
      ...prev,
      { from: resolveName(socket.id), fromId: socket.id, to: target, toName: resolveName(target), text: trimmed, own: true },
    ])
    setValue('')
  }

  function handleNameSubmit(e) {
    e.preventDefault()
    const trimmed = nameInput.trim()
    if (!trimmed) return
    setName(trimmed)
    localStorage.setItem('chatName', trimmed)
    socket.auth = { name: trimmed }
    socket.emit('set-name', trimmed)
  }

  return (
    <div className="page">
      <div className="frame">
        <header>
          <div className="title">Class Chat</div>
          <div className={`status ${status === 'connected' ? 'connected' : ''}`}>
            <span className="status-dot" />
            <span className="status-label">
              {status === 'connected'
                ? 'Connected'
                : status === 'disconnected'
                ? 'Disconnected'
                : status === 'error'
                ? 'Error'
                : 'Connecting…'}
            </span>
          </div>
        </header>
        {!name && (
          <section className="panel name-panel">
            <form className="name-form" onSubmit={handleNameSubmit}>
              <label>Set your display name</label>
              <div className="input-row">
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="e.g. Alex, Ms. Lee"
                  autoFocus
                />
                <button type="submit">Join</button>
              </div>
            </form>
          </section>
        )}
        <section className="panel">
          <div className="id-row">
            <span className="label">Your Name</span>
            <span className="id-chip">{name || 'Set a name to join'}</span>
          </div>
          <div className="id-row">
            <span className="label">Your ID</span>
            <span className="id-chip">{myId || '—'}</span>
          </div>
          <div className="id-row">
            <span className="label">Send to</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {peers.length === 0 && <option value="">No peers online</option>}
              {peers.map((peer) => (
                <option key={peer.id} value={peer.id}>
                  {peer.name} ({peer.id.slice(-4)})
                </option>
              ))}
            </select>
          </div>
        </section>
        <section className="messages">
          {messages.map((msg, idx) => (
            <article key={idx} className={`bubble ${msg.own ? 'own' : ''}`}>
              <div className="meta">
                <span>
                  {msg.to
                    ? `${msg.from || resolveName(msg.fromId)} → ${msg.toName || resolveName(msg.to)}`
                    : msg.from || resolveName(msg.fromId)}
                </span>
                <span>{new Date().toLocaleTimeString()}</span>
              </div>
              <div className="text">{msg.text}</div>
            </article>
          ))}
        </section>
        <footer>
          <div className="input-row">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="Send a quick note"
              autoComplete="off"
            />
            <button onClick={sendMessage}>Send</button>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default App
