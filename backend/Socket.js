import { Server } from 'socket.io'
import Chat from './models/Chat.js'

async function connectServer(server) {
    const allowedOrigin = process.env.ALLOWED_ORIGIN || process.env.FRONTEND_ORIGIN || '*'
    const corsOrigins = allowedOrigin === '*' ? '*' : allowedOrigin.split(',').map((o) => o.trim())

    const io = new Server(server, {
        cors: {
            origin: corsOrigins,
            methods: ['GET', 'POST'],
            credentials: true,
        },
    })

    const online = new Set()
    const names = new Map()   // socketId -> name
    const numbers = new Map() // socketId -> number

    const getName = (id) => names.get(id) || `User-${id.slice(-4)}`
    const getNumber = (id) => numbers.get(id) || ''

    const formatOnline = () => Array.from(online).map((id) => ({
        id,
        name: getName(id),
        number: getNumber(id)
    }))
    const broadcastOnline = () => io.emit('online', formatOnline())

    // Helper: find socket id by number
    const findSocketByNumber = (num) => {
        for (const [sid, n] of numbers.entries()) {
            if (n === num) return sid
        }
        return null
    }

    io.on('connection', async (socket) => {
        const providedName = (socket.handshake.auth?.name || '').trim()
        const providedNumber = (socket.handshake.auth?.number || '').trim()

        const name = providedName || `User-${socket.id.slice(-4)}`
        names.set(socket.id, name)
        if (providedNumber) numbers.set(socket.id, providedNumber)

        online.add(socket.id)
        socket.emit('welcome', { id: socket.id, name, number: providedNumber, online: formatOnline() })
        broadcastOnline()
        console.log('✅ Connected', socket.id, name, providedNumber)

        // Send chat history from DB
        if (providedNumber) {
            try {
                const chats = await Chat.find({
                    $or: [{ from: providedNumber }, { to: providedNumber }]
                }).sort({ createdAt: 1 }).limit(200)

                const history = chats.map(chat => ({
                    fromName: chat.fromName,
                    fromNumber: chat.from,
                    toName: chat.toName,
                    toNumber: chat.to,
                    text: chat.text,
                    timestamp: chat.createdAt,
                    own: chat.from === providedNumber
                }))

                socket.emit('chat-history', history)
                console.log(`📜 Sent ${history.length} history messages to ${name}`)
            } catch (err) {
                console.error('Error fetching chats', err)
            }
        }

        socket.on('set-name', (data) => {
            if (typeof data === 'object' && data.name && data.number) {
                names.set(socket.id, data.name.trim())
                numbers.set(socket.id, data.number.trim())
            } else if (typeof data === 'string') {
                const trimmed = data.trim()
                if (trimmed) names.set(socket.id, trimmed)
            }
            broadcastOnline()
        })

        socket.on('direct-message', async ({ to, text }) => {
            if (!to || !text?.trim()) return

            const fromNumber = getNumber(socket.id)
            const toNumber = getNumber(to)

            const payload = {
                from: socket.id,
                fromName: getName(socket.id),
                fromNumber,
                to,
                toName: getName(to),
                toNumber,
                text: text.trim(),
                timestamp: new Date().toISOString(),
            }

            // Send to recipient only (NOT back to sender — frontend adds it locally)
            io.to(to).emit('message', payload)

            // Save to MongoDB
            if (fromNumber && toNumber) {
                try {
                    const saved = await Chat.create({
                        from: fromNumber,
                        fromName: getName(socket.id),
                        to: toNumber,
                        toName: getName(to),
                        text: text.trim(),
                    })
                    console.log(`💾 Chat saved: ${getName(socket.id)} → ${getName(to)}: ${text.trim().slice(0, 30)}`)
                } catch (err) {
                    console.error('❌ Save chat error', err.message)
                }
            } else {
                console.warn('⚠️ Skipped save — missing number for from:', fromNumber, 'to:', toNumber)
            }
        })

        // ========================
        // WebRTC Video Call Signaling
        // ========================

        socket.on('call-user', ({ to, offer }) => {
            if (!to || !offer) return
            console.log(`📹 ${getName(socket.id)} is calling ${getName(to)}`)
            io.to(to).emit('incoming-call', {
                from: socket.id,
                fromName: getName(socket.id),
                fromNumber: getNumber(socket.id),
                offer,
            })
        })

        socket.on('call-accepted', ({ to, answer }) => {
            if (!to || !answer) return
            console.log(`✅ ${getName(socket.id)} accepted call from ${getName(to)}`)
            io.to(to).emit('call-accepted', {
                from: socket.id,
                answer,
            })
        })

        socket.on('call-rejected', ({ to }) => {
            if (!to) return
            console.log(`❌ ${getName(socket.id)} rejected call from ${getName(to)}`)
            io.to(to).emit('call-rejected', {
                from: socket.id,
                fromName: getName(socket.id),
            })
        })

        socket.on('ice-candidate', ({ to, candidate }) => {
            if (!to || !candidate) return
            io.to(to).emit('ice-candidate', {
                from: socket.id,
                candidate,
            })
        })

        socket.on('call-ended', ({ to }) => {
            if (!to) return
            console.log(`📵 ${getName(socket.id)} ended call with ${getName(to)}`)
            io.to(to).emit('call-ended', {
                from: socket.id,
            })
        })

        socket.on('disconnect', (reason) => {
            online.delete(socket.id)
            names.delete(socket.id)
            numbers.delete(socket.id)
            broadcastOnline()
            console.log('❌ Disconnected', socket.id, reason)
        })
    })
}

export default connectServer