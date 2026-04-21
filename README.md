# Class Chat Application

A real-time chat application with video calling built using the MERN stack and WebRTC.

## Features

- 🔐 User authentication with unique phone numbers
- 💬 Real-time 1-on-1 messaging via Socket.IO
- 📹 WebRTC video calling with mic/camera controls
- 🤖 AI-powered reply suggestions (OpenAI GPT-4o-mini)
- 📜 Persistent chat history (MongoDB)
- 🎨 Premium dark-themed UI

## Tech Stack

- **Frontend:** React 18, Vite, Socket.IO Client
- **Backend:** Node.js, Express 5, Socket.IO
- **Database:** MongoDB Atlas (Mongoose)
- **Video:** WebRTC with STUN servers
- **AI:** OpenAI API

## Setup

### Backend
```bash
cd backend
npm install
cp .env.example .env   # Fill in your values
npm start
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env   # Fill in your values
npm run dev
```

## Environment Variables

### Backend (`backend/.env`)
| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string |
| `OPENAI_API_KEY` | OpenAI API key for AI replies |
| `ALLOWED_ORIGIN` | Frontend URL for CORS (e.g. `https://your-app.vercel.app`) |
| `PORT` | Server port (default: 3000) |

### Frontend (`frontend/.env`)
| Variable | Description |
|---|---|
| `VITE_WS_URL` | Backend WebSocket URL |
| `VITE_API_URL` | Backend API URL |

## Deployment

### Backend (Render)
1. Create a **Web Service** on Render
2. Set root directory to `backend`
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables in Render dashboard

### Frontend (Vercel)
1. Import the repo on Vercel
2. Set root directory to `frontend`
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add environment variables in Vercel dashboard
