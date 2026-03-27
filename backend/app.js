import express from 'express'
import http from 'node:http'
import connectServer from './Socket.js'

const app = express()
const server = http.createServer(app)

await connectServer(server)

app.get('/', (req, res) => {
    res.send('OK')
})

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || '0.0.0.0'
server.listen(PORT, HOST, () => {
    console.log(`Listening on http://${HOST}:${PORT}`)
})