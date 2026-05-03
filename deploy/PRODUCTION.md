# MeterFlow Production Deployment Guide

This guide covers deploying MeterFlow to production with all security configurations.

## Prerequisites

1. **Docker & Docker Compose** installed
2. **Razorpay Account** with API keys
3. **Domain** with SSL certificate (Let's Encrypt recommended)
4. **Server** with at least 2GB RAM

---

## Step 1: Environment Configuration

### 1.1 Create Production Environment File

```bash
cp .env.example .env
```

### 1.2 Edit `.env` with Production Values

```env
# Server
NODE_ENV=production
PORT=4000
APP_ORIGIN=https://your-domain.com
BASE_URL=https://your-domain.com
SERVE_WEB=true

# Security - Generate a strong secret
JWT_SECRET=your-super-long-random-secret-min-32-chars

# Database
DATABASE_URL=postgres://meterflow:YOUR_PASSWORD@postgres:5432/meterflow
MONGO_URL=mongodb://mongo:27017/meterflow
REDIS_URL=redis://redis:6379

# Razorpay (get from https://razorpay.com/)
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_PAYMENT_DESCRIPTION=MeterFlow Pro upgrade
RAZORPAY_AMOUNT_PAISE=49900
RAZORPAY_CURRENCY=INR

# Billing
UPGRADE_URL=https://your-domain.com/billing
```

---

## Step 2: Database Setup

### 2.1 Start Database Services Only

```bash
docker compose up -d postgres mongo redis
```

### 2.2 Wait for Services to be Healthy

```bash
docker compose ps
```

All services should show `healthy` status.

---

## Step 3: Build and Deploy

### 3.1 Build the Application

```bash
docker compose build
```

### 3.2 Start All Services

```bash
docker compose up -d
```

### 3.2 Verify Health

```bash
curl https://your-domain.com/health/ready
```

Expected response:
```json
{
  "ok": true,
  "service": "meterflow",
  "checks": {
    "postgres": { "status": "ok" },
    "mongodb": { "status": "ok" },
    "redis": { "status": "ok" }
  }
}
```

---

## Step 4: Nginx & SSL Setup

### 4.1 Install Nginx

```bash
sudo apt update
sudo apt install nginx
```

### 4.2 Copy Nginx Configuration

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/meterflow
sudo ln -s /etc/nginx/sites-available/meterflow /etc/nginx/sites-enabled/
```

### 4.3 Update `server_name` in nginx.conf

Replace `your-domain.com` with your actual domain.

### 4.4 Install SSL Certificate (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 4.5 Test Nginx Configuration

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Step 5: Razorpay Webhook Configuration

### 5.1 Create Webhook in Razorpay Dashboard

1. Go to https://dashboard.razorpay.com/#/app/settings/webhooks
2. Add endpoint: `https://your-domain.com/payments/webhook`
3. Select events:
   - `payment_link.paid`
   - `payment_link.fulfilled`
   - `payment_link.expired`

### 5.2 Get Webhook Secret

Copy the webhook signing secret and add to `.env`:
```
RAZORPAY_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Step 6: Verify Deployment

### 6.1 Check All Endpoints

```bash
# Health check
curl https://your-domain.com/health

# Auth endpoint
curl https://your-domain.com/auth/me

# Should return 401 (unauthorized) for unauthenticated requests
```

### 6.2 Test API Key Flow

1. Register a new user
2. Create an API
3. Generate an API key
4. Make a test request:
```bash
curl -H "x-api-key: YOUR_API_KEY" \
  https://your-domain.com/gateway/YOUR_API_ID/pokemon/ditto
```

---

## Monitoring & Logs

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f meterflow
```

### Health Checks

- **Liveness Probe**: `/health/live` - Is the process running?
- **Readiness Probe**: `/health/ready` - Can it serve traffic?

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| 502 Bad Gateway | Check if backend is running: `docker compose ps` |
| Razorpay webhook fails | Verify webhook secret in `.env` |
| Database connection error | Check `DATABASE_URL` in `.env` |
| Rate limiting not working | Ensure Redis is running |

### Rollback

```bash
docker compose down
docker compose up -d --build
```

---

## Security Checklist

- [ ] Change default JWT_SECRET
- [ ] Use strong PostgreSQL password
- [ ] Enable SSL/TLS
- [ ] Configure Razorpay webhook signing secret
- [ ] Set appropriate rate limits
- [ ] Configure spend caps for users
- [ ] Enable firewall rules
- [ ] Regular backup of databases