import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    {
      urls: 'turn:global.relay.metered.ca:80',
      username: 'b79c6c68a1b3c3e9bdb6e910',
      credential: 'xlBmrGFJSvlagjNe',
    },
    {
      urls: 'turn:global.relay.metered.ca:80?transport=tcp',
      username: 'b79c6c68a1b3c3e9bdb6e910',
      credential: 'xlBmrGFJSvlagjNe',
    },
    {
      urls: 'turn:global.relay.metered.ca:443',
      username: 'b79c6c68a1b3c3e9bdb6e910',
      credential: 'xlBmrGFJSvlagjNe',
    },
    {
      urls: 'turns:global.relay.metered.ca:443?transport=tcp',
      username: 'b79c6c68a1b3c3e9bdb6e910',
      credential: 'xlBmrGFJSvlagjNe',
    },
  ],
  // Explicit unified-plan ensures consistent SDP negotiation across all browsers
  sdpSemantics: 'unified-plan',
  bundlePolicy: 'max-bundle',
}

// Call states: idle | calling | ringing | connected
const VideoCall = forwardRef(function VideoCall({ socket, myId, peers, target }, ref) {
  const [callState, setCallState] = useState('idle')
  const [callerInfo, setCallerInfo] = useState(null) // { from, fromName, fromNumber }
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [callDuration, setCallDuration] = useState(0)

  const peerConnection = useRef(null)
  const localStream = useRef(null)
  const remoteStream = useRef(null)
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const callTargetRef = useRef(null) // who we're in call with
  const durationInterval = useRef(null)
  const iceCandidateQueue = useRef([]) // Queue for ICE candidates that arrive early
  const remoteDescriptionSet = useRef(false) // Track if remote description is set

  // FIX 1: Use a ref for callState so socket handlers always read the latest value
  // without needing callState in the socket effect dependency array.
  // This prevents ICE candidates from being lost when callState transitions
  // (e.g. 'calling' → 'connected') cause the socket effect to teardown and re-register.
  const callStateRef = useRef('idle')
  useEffect(() => {
    callStateRef.current = callState
  }, [callState])

  // Cleanup helper
  const cleanup = useCallback(() => {
    if (durationInterval.current) {
      clearInterval(durationInterval.current)
      durationInterval.current = null
    }
    if (peerConnection.current) {
      peerConnection.current.onicecandidate = null
      peerConnection.current.ontrack = null
      peerConnection.current.onconnectionstatechange = null
      peerConnection.current.oniceconnectionstatechange = null
      peerConnection.current.close()
      peerConnection.current = null
    }
    if (localStream.current) {
      localStream.current.getTracks().forEach((t) => t.stop())
      localStream.current = null
    }
    if (remoteStream.current) {
      remoteStream.current = null
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    callTargetRef.current = null
    iceCandidateQueue.current = []
    remoteDescriptionSet.current = false
    setCallDuration(0)
    setCallerInfo(null)
    setMicOn(true)
    setCamOn(true)
    setCallState('idle')
  }, [])

  // Process any queued ICE candidates
  const processIceQueue = useCallback(async () => {
    if (!peerConnection.current) return
    const queue = [...iceCandidateQueue.current]
    iceCandidateQueue.current = []
    console.log(`📨 Processing ${queue.length} queued ICE candidates`)
    for (const candidate of queue) {
      try {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate))
      } catch (err) {
        console.error('Error adding queued ICE candidate:', err)
      }
    }
  }, [])

  // Create RTCPeerConnection with handlers
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(ICE_SERVERS)

    pc.onicecandidate = (event) => {
      if (event.candidate && callTargetRef.current) {
        console.log('🧊 Sending ICE candidate:', event.candidate.type, event.candidate.protocol)
        socket.emit('ice-candidate', {
          to: callTargetRef.current,
          candidate: event.candidate,
        })
      }
    }

    // FIX 2: Robust ontrack handler.
    // - Some browsers fire ontrack with event.streams[0] undefined — use event.track fallback.
    // - FIX 3: Explicitly call .play() after assigning srcObject to defeat autoplay policy
    //   on HTTPS-deployed pages (Vercel, Render, etc.) which block unmuted autoplay.
    pc.ontrack = (event) => {
      console.log('🎥 ontrack fired, streams:', event.streams?.length, 'track:', event.track?.kind)

      // Build the remote stream, using event.streams[0] when available and
      // falling back to manually adding the track to a new MediaStream.
      if (event.streams && event.streams[0]) {
        remoteStream.current = event.streams[0]
      } else {
        // Fallback path: create/reuse a MediaStream and add the incoming track
        if (!remoteStream.current) {
          remoteStream.current = new MediaStream()
        }
        if (event.track) {
          remoteStream.current.addTrack(event.track)
        }
      }

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream.current
        // Explicitly start playback — autoplay for unmuted video is blocked by browsers
        // unless .play() is called after a user gesture or programmatically like this.
        remoteVideoRef.current.play().catch((err) => {
          console.warn('Remote video autoplay blocked:', err)
        })
      }
    }

    pc.oniceconnectionstatechange = () => {
      console.log('🧊 ICE connection state:', pc.iceConnectionState)
    }

    pc.onconnectionstatechange = () => {
      console.log('🔗 Connection state:', pc.connectionState)
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        hangUp()
      }
    }

    peerConnection.current = pc
    return pc
  }, [socket])

  // Get user media
  const getMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })
      localStream.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        localVideoRef.current.play().catch(() => {})
      }
      return stream
    } catch (err) {
      console.error('Failed to get media:', err)
      // Try audio only if video fails
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: true,
        })
        localStream.current = stream
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream
          localVideoRef.current.play().catch(() => {})
        }
        setCamOn(false)
        return stream
      } catch (err2) {
        console.error('Failed to get any media:', err2)
        alert('Could not access camera or microphone. Please allow permissions.')
        return null
      }
    }
  }, [])

  // Start duration timer
  const startTimer = useCallback(() => {
    setCallDuration(0)
    durationInterval.current = setInterval(() => {
      setCallDuration((prev) => prev + 1)
    }, 1000)
  }, [])

  // === OUTGOING CALL ===
  const startCall = useCallback(async (targetId) => {
    if (callState !== 'idle' || !targetId) return

    callTargetRef.current = targetId
    setCallState('calling')
    iceCandidateQueue.current = []
    remoteDescriptionSet.current = false

    const stream = await getMedia()
    if (!stream) {
      cleanup()
      return
    }

    const pc = createPeerConnection()
    stream.getTracks().forEach((track) => pc.addTrack(track, stream))

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      socket.emit('call-user', {
        to: targetId,
        offer: pc.localDescription,
      })
    } catch (err) {
      console.error('Error creating offer:', err)
      cleanup()
    }
  }, [callState, socket, getMedia, createPeerConnection, cleanup])

  // Expose startCall to parent via ref
  useImperativeHandle(ref, () => ({ startCall }), [startCall])

  // === ACCEPT INCOMING CALL ===
  const acceptCall = useCallback(async () => {
    if (!callerInfo) return

    callTargetRef.current = callerInfo.from
    setCallState('connected')
    startTimer()

    const stream = await getMedia()
    if (!stream) {
      cleanup()
      return
    }

    const pc = createPeerConnection()
    stream.getTracks().forEach((track) => pc.addTrack(track, stream))

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(callerInfo.offer))
      remoteDescriptionSet.current = true

      // Process any ICE candidates that arrived while we were setting up
      await processIceQueue()

      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      socket.emit('call-accepted', {
        to: callerInfo.from,
        answer: pc.localDescription,
      })
    } catch (err) {
      console.error('Error accepting call:', err)
      cleanup()
    }
  }, [callerInfo, socket, getMedia, createPeerConnection, cleanup, startTimer, processIceQueue])

  // === REJECT INCOMING CALL ===
  const rejectCall = useCallback(() => {
    if (!callerInfo) return
    socket.emit('call-rejected', { to: callerInfo.from })
    cleanup()
  }, [callerInfo, socket, cleanup])

  // === HANG UP ===
  const hangUp = useCallback(() => {
    if (callTargetRef.current) {
      socket.emit('call-ended', { to: callTargetRef.current })
    }
    cleanup()
  }, [socket, cleanup])

  // === TOGGLE MIC ===
  const toggleMic = useCallback(() => {
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setMicOn(audioTrack.enabled)
      }
    }
  }, [])

  // === TOGGLE CAMERA ===
  const toggleCam = useCallback(() => {
    if (localStream.current) {
      const videoTrack = localStream.current.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled
        setCamOn(videoTrack.enabled)
      }
    }
  }, [])

  // Format duration as mm:ss
  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // === SOCKET EVENT LISTENERS ===
  // FIX 1 (continued): callState is intentionally NOT in the dependency array here.
  // All handlers that previously read callState now use callStateRef.current instead.
  // This keeps the socket listeners stable for the entire lifetime of the socket
  // connection, preventing ICE candidates from being dropped during the brief
  // teardown/re-registration that happened on every callState transition.
  useEffect(() => {
    if (!socket) return

    function handleIncomingCall(data) {
      if (callStateRef.current !== 'idle') {
        // Already in a call, auto-reject
        socket.emit('call-rejected', { to: data.from })
        return
      }
      console.log('📞 Incoming call from', data.fromName)
      iceCandidateQueue.current = []
      remoteDescriptionSet.current = false
      setCallerInfo(data)
      setCallState('ringing')
    }

    function handleCallAccepted(data) {
      if (!peerConnection.current || callStateRef.current !== 'calling') return

      console.log('✅ Call accepted, setting remote description')
      peerConnection.current
        .setRemoteDescription(new RTCSessionDescription(data.answer))
        .then(async () => {
          remoteDescriptionSet.current = true
          // Process any ICE candidates that arrived before remote description was set
          await processIceQueue()
          setCallState('connected')
          startTimer()
        })
        .catch((err) => {
          console.error('Error setting remote description:', err)
          cleanup()
        })
    }

    function handleCallRejected() {
      cleanup()
    }

    function handleIceCandidate(data) {
      if (!data.candidate) return

      // If peer connection doesn't exist or remote description isn't set yet, queue it
      if (!peerConnection.current || !remoteDescriptionSet.current) {
        console.log('📥 Queuing ICE candidate (remote desc not set yet)')
        iceCandidateQueue.current.push(data.candidate)
        return
      }

      // Otherwise add immediately
      console.log('📥 Adding ICE candidate directly')
      peerConnection.current
        .addIceCandidate(new RTCIceCandidate(data.candidate))
        .catch((err) => console.error('Error adding ICE candidate:', err))
    }

    function handleCallEnded() {
      cleanup()
    }

    socket.on('incoming-call', handleIncomingCall)
    socket.on('call-accepted', handleCallAccepted)
    socket.on('call-rejected', handleCallRejected)
    socket.on('ice-candidate', handleIceCandidate)
    socket.on('call-ended', handleCallEnded)

    return () => {
      socket.off('incoming-call', handleIncomingCall)
      socket.off('call-accepted', handleCallAccepted)
      socket.off('call-rejected', handleCallRejected)
      socket.off('ice-candidate', handleIceCandidate)
      socket.off('call-ended', handleCallEnded)
    }
  }, [socket, cleanup, startTimer, processIceQueue])

  // Get caller/target name for display
  const getPeerName = (peerId) => {
    const p = peers.find((peer) => peer.id === peerId)
    return p?.name || 'Unknown'
  }

  // ========== RENDER ==========

  // Incoming call modal
  if (callState === 'ringing' && callerInfo) {
    return (
      <div className="vc-overlay">
        <div className="vc-incoming-modal">
          <div className="vc-incoming-pulse" />
          <div className="vc-incoming-avatar">
            {(callerInfo.fromName || '?').charAt(0).toUpperCase()}
          </div>
          <h2 className="vc-incoming-name">{callerInfo.fromName || 'Unknown'}</h2>
          <p className="vc-incoming-label">Incoming video call…</p>
          <div className="vc-incoming-actions">
            <button className="vc-btn vc-reject-btn" onClick={rejectCall} title="Reject">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1 0-1.36C3.42 8.71 7.46 7 12 7s8.58 1.71 11.71 4.72c.18.18.29.44.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
              </svg>
            </button>
            <button className="vc-btn vc-accept-btn" onClick={acceptCall} title="Accept">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Calling state (waiting for answer)
  if (callState === 'calling') {
    return (
      <div className="vc-overlay">
        <div className="vc-calling-screen">
          <div className="vc-calling-avatar">
            {getPeerName(callTargetRef.current).charAt(0).toUpperCase()}
          </div>
          <h2 className="vc-calling-name">{getPeerName(callTargetRef.current)}</h2>
          <p className="vc-calling-label">Calling…</p>
          <div className="vc-calling-dots">
            <span /><span /><span />
          </div>
          <button className="vc-btn vc-hangup-btn vc-cancel-call" onClick={hangUp}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // Connected — video call in progress
  if (callState === 'connected') {
    return (
      <div className="vc-overlay vc-connected">
        {/* Remote video (full screen) */}
        <video
          ref={(el) => {
            remoteVideoRef.current = el
            // Re-apply remote stream when this element mounts (e.g. after a re-render)
            // and explicitly call play() to defeat autoplay policy on HTTPS pages.
            if (el && remoteStream.current) {
              el.srcObject = remoteStream.current
              el.play().catch((err) => {
                console.warn('Remote video play() blocked:', err)
              })
            }
          }}
          autoPlay
          playsInline
          className="vc-remote-video"
        />

        {/* Local video (PiP) */}
        <video
          ref={(el) => {
            localVideoRef.current = el
            // Re-apply local stream when this element mounts
            if (el && localStream.current) {
              el.srcObject = localStream.current
              el.play().catch(() => {})
            }
          }}
          autoPlay
          playsInline
          muted
          className="vc-local-video"
        />

        {/* Top bar */}
        <div className="vc-top-bar">
          <span className="vc-peer-name">{getPeerName(callTargetRef.current)}</span>
          <span className="vc-timer">{formatDuration(callDuration)}</span>
        </div>

        {/* Controls */}
        <div className="vc-controls">
          <button
            className={`vc-ctrl-btn ${!micOn ? 'vc-off' : ''}`}
            onClick={toggleMic}
            title={micOn ? 'Mute mic' : 'Unmute mic'}
          >
            {micOn ? (
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
              </svg>
            )}
          </button>

          <button className="vc-ctrl-btn vc-hangup" onClick={hangUp} title="Hang up">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1 0-1.36C3.42 8.71 7.46 7 12 7s8.58 1.71 11.71 4.72c.18.18.29.44.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
            </svg>
          </button>

          <button
            className={`vc-ctrl-btn ${!camOn ? 'vc-off' : ''}`}
            onClick={toggleCam}
            title={camOn ? 'Turn off camera' : 'Turn on camera'}
          >
            {camOn ? (
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.55-.18L19.73 21 21 19.73 3.27 2z"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    )
  }

  // Idle — just render a hidden container (videos need refs even when hidden for setup)
  return (
    <>
      <video ref={localVideoRef} autoPlay playsInline muted style={{ display: 'none' }} />
      <video ref={remoteVideoRef} autoPlay playsInline style={{ display: 'none' }} />
    </>
  )
})

export default VideoCall
