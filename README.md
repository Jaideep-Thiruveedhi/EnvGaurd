# EnvGuard (MVP Foundation)

AI-powered configuration health for your repository.

This is the project foundation only — no scanning / AI logic yet.

## Structure

- `frontend/` — React + Vite + Tailwind CSS
- `backend/` — Node.js + Express + CORS

## Run backend

```bash
cd backend
npm install
npm run dev
# health: GET http://localhost:5000/api/health
```

## Run frontend

```bash
cd frontend
npm install
npm run dev
# app: http://localhost:5173
```

## Config

- Backend: `backend/.env` (see `.env.example`)
- Frontend: `frontend/.env` (see `.env.example`, uses `VITE_API_URL`)
