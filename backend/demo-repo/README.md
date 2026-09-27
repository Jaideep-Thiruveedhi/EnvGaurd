# Demo Project

Example checkout service used to demo EnvGuard.

## Setup

```bash
cp .env.example .env
npm install
npm start
```

## Configuration

| Variable   | Description          |
| ---------- | -------------------- |
| PORT       | HTTP port (default 3000) |
| JWT_SECRET | Secret for signing tokens |

> Note: OAuth login and the database connection need some extra
> environment configuration (see source code for details).
