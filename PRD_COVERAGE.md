# MeterFlow PRD Coverage

## Implemented

- Developer signup/login with bcrypt password hashing and JWT access tokens.
- API registration with origin base URL.
- Managed API key creation using `mf_test_...` / `mf_live_...` format.
- SHA-256 key hashing; raw keys are returned only at creation/rotation.
- Key revoke and key rotation with a 24-hour grace period.
- Gateway route at `/gateway/:apiId/*`.
- Gateway validates key, checks rate limit, logs request, proxies to origin, and captures status/latency.
- Redis-backed key cache and per-second sliding-window rate limiting.
- MongoDB usage log schema with required compound indexes and 90-day TTL.
- Postgres schema for users, plans, API configs, API keys, and billing periods.
- BullMQ billing calculation queue with idempotent job IDs.
- Integer paise billing calculations.
- Socket.io live usage event emission.
- Dashboard for onboarding, API creation, first cURL command, key manager, usage metrics, request ledger, and billing calculation.
- Docker production artifacts for single-host deployment.
- In-memory demo runtime for verification without Docker.

## Partially Implemented

- RBAC: user roles exist in schema and JWT claims, but role-based route permissions are not expanded.
- Spend caps: alert/hard-cap fields are modeled and shown, but there is no UI to edit caps and no gateway hard-stop enforcement yet.
- Sliding window rate limiting: implemented as a rolling per-second Redis counter sum, not a weighted sorted-set limiter.
- Billing engine: calculation and idempotent invoice records exist, but period-end scheduling and threshold-trigger jobs are not wired.
- Consumer experience: dashboard is owner/operator focused; separate API consumer dashboards are not built.
- Revenue dashboard: current bill and invoice calculation exist; fuller revenue analytics by endpoint/customer are not built.
- Docker deployment: files are ready, but Docker Desktop must be installed on the host to run the stack locally.

## Not Implemented Yet

- JWT refresh tokens.
- Stripe or Razorpay money movement.
- Nginx TLS ingress config.
- Automated reconciliation job.
- truffleHog or secret-scanning CI pipeline.
- Cold-storage archival after 30 days.
- Multi-tenant enterprise isolation, compliance, and admin RBAC.
- Public hosted deployment.

## Current Verification

- `npm run build` passes.
- `npm run demo` works without Docker.
- Browser flow verified: signup, API creation, key generation, gateway proxy to PokeAPI, HTTP 200 response, and real-time dashboard ledger update.
