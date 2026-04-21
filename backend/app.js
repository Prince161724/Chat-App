import express from 'express'
import http from 'node:http'
import cors from 'cors'
import OpenAI from 'openai'
import dotenv from 'dotenv'
import connectServer from './Socket.js'
import connectDB from './db.js'

dotenv.config();

const app = express()
const server = http.createServer(app)

app.use(cors({ origin: '*' }))
app.use(express.json({ limit: '1mb' }))

const openaiApiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY
const openaiClient = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null

await connectDB();
await connectServer(server);

app.get('/', (req, res) => {
    res.send('OK')
})

app.post('/ai-reply', async (req, res) => {
    if (!openaiClient) {
        return res.status(500).json({ error: 'Missing OPENAI_API_KEY on server' })
    }

    const text = (req.body?.text || '').trim()
    if (!text) {
        return res.status(400).json({ error: 'text is required' })
    }

    try {
        const completion = await openaiClient.chat.completions.create({ 
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content:
                        'You are a concise, friendly classroom chat assistant. Offer brief, polite replies that keep the conversation positive.',
                },
                { role: 'user', content: text },
            ],
            max_tokens: 80,
            temperature: 0.7,
        })

        const reply = completion.choices?.[0]?.message?.content?.trim()
        if (!reply) {
            return res.status(502).json({ error: 'No reply generated' })
        }
        return res.json({ reply })
    } catch (err) {
        console.error('AI reply error', err?.message)
        return res.status(500).json({ error: 'Failed to generate reply' })
    }
})

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || '0.0.0.0'
server.listen(PORT, HOST, () => {
    console.log(`Listening on http://${HOST}:${PORT}`)
})