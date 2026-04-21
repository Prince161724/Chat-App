import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import VideoCall from './VideoCall'

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3000'
const API_URL = (import.meta.env.VITE_API_URL || WS_URL).replace(/\/+$/, '')
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
  const [nameInput, setNameInput] = useState('')
  const [numberInput, setNumberInput] = useState('')
  const [name, setName] = useState(() => localStorage.getItem('chatName') || '')
  const [number, setNumber] = useState(() => localStorage.getItem('chatNumber') || '')
  const nameRef = useRef(name)
  const numberRef = useRef(number)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const messagesEndRef = useRef(null)
  const videoCallRef = useRef(null)

  // Get selected peer's number
  const targetPeerNumber = useMemo(() => {
    const p = peers.find((p) => p.id === target)
    return p?.number || ''
  }, [peers, target])

  // Filter messages for current conversation only
  const filteredMessages = useMemo(() => {
    if (!targetPeerNumber) return []
    return messages.filter((msg) => {
      if (msg.system) return false
      // Own messages sent TO this peer
      if (msg.own && msg.toNumber === targetPeerNumber) return true
      // Messages received FROM this peer
      if (!msg.own && msg.fromNumber === targetPeerNumber) return true
      return false
    })
  }, [messages, targetPeerNumber])

  // Auto-scroll to bottom when filtered messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [filteredMessages])

  useEffect(() => {
    function handleConnect() {
      setStatus('connected')
      setMyId(socket.id)
    }

    function handleDisconnect(reason) {
      setStatus('disconnected')
      setMessages((prev) => [...prev, { system: true, text: `Disconnected: ${reason}` }])
    }

    function handleMessage(payload) {
      const text = payload?.text || JSON.stringify(payload)
      setMessages((prev) => [
        ...prev,
        {
          fromName: payload?.fromName || 'Unknown',
          fromNumber: payload?.fromNumber || '',
          toName: payload?.toName || '',
          toNumber: payload?.toNumber || '',
          text,
          own: false, // Messages from server are always from others
          timestamp: payload?.timestamp || new Date().toISOString(),
        },
      ])
    }

    function handleChatHistory(history = []) {
      if (!Array.isArray(history) || history.length === 0) return
      const mapped = history.map((msg) => ({
        fromName: msg.fromName,
        fromNumber: msg.fromNumber,
        toName: msg.toName,
        toNumber: msg.toNumber,
        text: msg.text,
        own: msg.own,
        timestamp: msg.timestamp,
        isHistory: true,
      }))
      setMessages(mapped)
    }

    function handleOnline(list = []) {
      const peersOnly = list.filter((item) => item.id !== socket.id)
      setPeers(peersOnly)
      setTarget((prev) => {
        const stillExists = peersOnly.some((p) => p.id === prev)
        return stillExists ? prev : (peersOnly[0]?.id || '')
      })
    }

    function handleWelcome(payload = {}) {
      if (payload.id) setMyId(payload.id)
      if (Array.isArray(payload.online)) {
        const peersOnly = payload.online.filter((item) => item.id !== socket.id)
        setPeers(peersOnly)
        setTarget((prev) => {
          const stillExists = peersOnly.some((p) => p.id === prev)
          return stillExists ? prev : (peersOnly[0]?.id || '')
        })
      }
    }

    function handleConnectError(err) {
      console.error('Socket connect error', err?.message)
      setStatus('error')
      setMessages((prev) => [...prev, { system: true, text: `Connect error: ${err?.message || 'unknown'}` }])
    }

    function handleReconnectAttempt(attempt) {
      setStatus('connecting')
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('message', handleMessage)
    socket.on('chat-history', handleChatHistory)
    socket.on('online', handleOnline)
    socket.on('welcome', handleWelcome)
    socket.on('connect_error', handleConnectError)
    socket.on('reconnect_attempt', handleReconnectAttempt)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('message', handleMessage)
      socket.off('chat-history', handleChatHistory)
      socket.off('online', handleOnline)
      socket.off('welcome', handleWelcome)
      socket.off('connect_error', handleConnectError)
      socket.off('reconnect_attempt', handleReconnectAttempt)
      socket.disconnect()
    }
  }, [])

  // Connect socket when name & number are set
  useEffect(() => {
    if (!name || !number) return
    socket.auth = { name, number }
    if (!socket.connected) {
      setStatus('connecting')
      socket.connect()
    }
  }, [name, number])

  useEffect(() => {
    nameRef.current = name
    numberRef.current = number
  }, [name, number])

  const lastPeerMessage = useMemo(
    () => [...messages].reverse().find((msg) => !msg.own && !msg.system && !!msg.text),
    [messages]
  )

  function sendMessage() {
    const trimmed = value.trim()
    if (!trimmed || !target) return
    const targetPeer = peers.find((p) => p.id === target)
    socket.emit('direct-message', { to: target, text: trimmed })
    // Add locally (server does NOT echo back to sender)
    setMessages((prev) => [
      ...prev,
      {
        fromName: name,
        fromNumber: number,
        toName: targetPeer?.name || '',
        toNumber: targetPeer?.number || '',
        text: trimmed,
        own: true,
        timestamp: new Date().toISOString(),
      },
    ])
    setValue('')
  }

  function handleNameSubmit(e) {
    e.preventDefault()
    const trimmedName = nameInput.trim()
    const trimmedNumber = numberInput.trim()
    if (!trimmedName || !trimmedNumber) return
    setName(trimmedName)
    setNumber(trimmedNumber)
    localStorage.setItem('chatName', trimmedName)
    localStorage.setItem('chatNumber', trimmedNumber)
  }

  function handleLogout() {
    socket.disconnect()
    localStorage.removeItem('chatName')
    localStorage.removeItem('chatNumber')
    setName('')
    setNumber('')
    setNameInput('')
    setNumberInput('')
    setMessages([])
    setPeers([])
    setTarget('')
    setMyId('')
    setStatus('connecting')
  }

  async function generateAiReply() {
    if (!lastPeerMessage?.text || aiLoading) return
    setAiError('')
    setAiLoading(true)
    try {
      const res = await fetch(`${API_URL}/ai-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: lastPeerMessage.text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Status ${res.status}`)
      if (!data?.reply) throw new Error('No reply returned')
      setValue(data.reply)
    } catch (err) {
      setAiError(err?.message || 'Failed to generate reply')
    } finally {
      setAiLoading(false)
    }
  }

  function formatTime(ts) {
    if (!ts) return ''
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  // ---------- LOGIN SCREEN ----------
  if (!name || !number) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-icon">💬</div>
          <h1 className="login-title">Class Chat</h1>
          <p className="login-subtitle">Enter your name and unique number to join</p>
          <form onSubmit={handleNameSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="login-name">Display Name</label>
              <input
                id="login-name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. Alex, Prince"
                autoFocus
              />
            </div>
            <div className="login-field">
              <label htmlFor="login-number">Your Unique Number</label>
              <input
                id="login-number"
                value={numberInput}
                onChange={(e) => setNumberInput(e.target.value)}
                placeholder="e.g. 9876543210"
              />
            </div>
            <button type="submit" className="login-btn">
              Join Chat →
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ---------- CHAT SCREEN ----------
  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title">💬 Class Chat</div>
          <button className="logout-btn" onClick={handleLogout} title="Logout">⏻</button>
        </div>

        <div className="profile-card">
          <div className="avatar">{name.charAt(0).toUpperCase()}</div>
          <div className="profile-info">
            <div className="profile-name">{name}</div>
            <div className="profile-number">#{number}</div>
          </div>
          <span className={`connection-dot ${status}`} title={status} />
        </div>

        <div className="peers-section">
          <div className="peers-label">Online — {peers.length}</div>
          {peers.length === 0 && <div className="no-peers">No one else is online</div>}
          {peers.map((peer) => (
            <div
              key={peer.id}
              className={`peer-item ${target === peer.id ? 'active' : ''}`}
              onClick={() => setTarget(peer.id)}
            >
              <div className="peer-avatar">{(peer.name || '?').charAt(0).toUpperCase()}</div>
              <div className="peer-info">
                <div className="peer-name">{peer.name}</div>
                <div className="peer-number">#{peer.number || peer.id.slice(-4)}</div>
              </div>
              <span className="peer-online-dot" />
            </div>
          ))}
        </div>

        {/* AI section */}
        <div className="ai-section">
          <button onClick={generateAiReply} disabled={!lastPeerMessage || aiLoading} className="ai-btn">
            {aiLoading ? '⏳ Thinking…' : '🤖 AI Reply'}
          </button>
          {aiError && <div className="ai-error">{aiError}</div>}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="chat-main">
        <div className="chat-header">
          {target ? (
            <>
              <div className="chat-header-avatar">
                {(peers.find((p) => p.id === target)?.name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="chat-header-info">
                <div className="chat-header-name">
                  {peers.find((p) => p.id === target)?.name || 'Unknown'}
                </div>
                <div className="chat-header-number">
                  #{peers.find((p) => p.id === target)?.number || ''}
                </div>
              </div>
              <button
                className="vc-call-btn"
                onClick={() => videoCallRef.current?.startCall(target)}
                title="Start video call"
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                  <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                </svg>
              </button>
            </>
          ) : (
            <div className="chat-header-name">Select a peer to chat</div>
          )}
        </div>

        <section className="messages-area">
          {filteredMessages.length === 0 && (
            <div className="empty-chat">
              <div className="empty-icon">💬</div>
              <p>{target ? 'No messages yet. Say hello!' : 'Select a peer to start chatting'}</p>
            </div>
          )}
          {filteredMessages.map((msg, idx) => (
            <div key={idx} className={`msg-row ${msg.own ? 'own' : 'other'}`}>
              <div className={`msg-bubble ${msg.own ? 'own' : 'other'}`}>
                <div className="msg-sender">
                  {msg.own ? 'You' : msg.fromName || 'Unknown'}
                  {msg.isHistory && <span className="history-badge">history</span>}
                </div>
                <div className="msg-text">{msg.text}</div>
                <div className="msg-time">{formatTime(msg.timestamp)}</div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </section>

        <footer className="chat-footer">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder={target ? 'Type a message…' : 'Select a peer first'}
            autoComplete="off"
            disabled={!target}
          />
          <button onClick={sendMessage} disabled={!target || !value.trim()} className="send-btn">
            Send
          </button>
        </footer>
      </main>

      {/* Video Call Component */}
      <VideoCall
        ref={videoCallRef}
        socket={socket}
        myId={myId}
        peers={peers}
        target={target}
      />
    </div>
  )
}

export default App
