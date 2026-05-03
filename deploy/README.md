# MeterFlow Deployment

## Single-host Docker deployment

This is the simplest production-style deployment. It builds the React app, serves it from the Node server, and runs Postgres, MongoDB, and Redis beside it.

```powershell
$env:JWT_SECRET = "replace-with-a-long-random-production-secret"
docker compose -f docker-compose.prod.yml up --build -d
```

Open:

```text
http://localhost:4000
```

Health check:

```powershell
Invoke-WebRequest http://localhost:4000/health -UseBasicParsing
```

## Managed-service deployment

Use the root `Dockerfile` for the application container and attach managed services:

- Postgres: set `DATABASE_URL`
- MongoDB: set `MONGO_URL`
- Redis: set `REDIS_URL`
- App origin: set `APP_ORIGIN=https://your-domain.com`
- Web serving: set `SERVE_WEB=true`
- Secret: set `JWT_SECRET` to a long random value

Expose port `4000`.
