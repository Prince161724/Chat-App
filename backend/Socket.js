import { Server } from 'socket.io'

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
    const names = new Map()

    const getName = (id) => names.get(id) || `User-${id.slice(-4)}`
    const formatOnline = () => Array.from(online).map((id) => ({ id, name: getName(id) }))
    const broadcastOnline = () => io.emit('online', formatOnline())

    io.on('connection', (socket) => {
        const providedName = (socket.handshake.auth?.name || '').trim()
        const name = providedName || `User-${socket.id.slice(-4)}`
        names.set(socket.id, name)

        online.add(socket.id)
        socket.emit('welcome', { id: socket.id, name, online: formatOnline() })
        broadcastOnline()
        console.log('Connected', socket.id, name)

        socket.on('set-name', (nextName = '') => {
            const trimmed = nextName.trim()
            if (!trimmed) return
            names.set(socket.id, trimmed)
            broadcastOnline()
        })

        socket.on('direct-message', ({ to, text }) => {
            if (!to || !text?.trim()) return
            const payload = {
                from: socket.id,
                fromName: getName(socket.id),
                to,
                toName: getName(to),
                text: text.trim(),
            }
            io.to(to).emit('message', payload)
            socket.emit('message', payload)
        })

        socket.on('disconnect', (reason) => {
            online.delete(socket.id)
            names.delete(socket.id)
            broadcastOnline()
            console.log('Disconnected', socket.id, reason)
        })
    })
}

export default connectServer