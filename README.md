# PG Clinical Activity Tracking System

MERN implementation scaffold for PG clinical tracking with backend APIs, frontend screens, analytics, reporting, and audit logs.

## Run locally (without Docker)

### Backend
- `cd backend`
- `npm install`
- `npm run build`
- `npm run seed` (optional, seeds demo users/departments)
- `npm run dev`

### Frontend
- `cd frontend`
- `npm install`
- `npm run dev`

Backend base URL: `http://localhost:4000/api`  
Frontend URL: `http://localhost:5173`

## Run with Docker Compose

- `docker compose up --build`

Services:
- MongoDB: `localhost:27017`
- Backend: `http://localhost:4000`
- Frontend: `http://localhost:5173`

## Demo credentials (from seed)

- Admin: `admin` / `admin123`
- Consultant: `consultant1` / `consult123`
- PG: `pg1` / `pg123456`

