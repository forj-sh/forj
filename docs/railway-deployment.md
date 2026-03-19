# Railway Deployment Guide for Forj

**Last updated:** March 16, 2026
**Project:** forj (https://railway.com/project/56e0b66e-4e3d-4563-8343-f6589dce7ec2)

This guide walks through deploying Forj to Railway for Phase 7 production launch.

---

## Prerequisites

- [x] Railway CLI installed (`npm i -g @railway/cli`)
- [x] Railway project created and linked (`railway init`)
- [x] Railway account connected to GitHub

---

## Architecture Overview

Forj requires **4 Railway services**:

1. **forj-api** - Fastify API server (packages/api)
2. **forj-workers** - BullMQ workers (packages/workers)
3. **PostgreSQL** - Database (Railway plugin)
4. **Redis** - Job queue + caching (Railway plugin)

---

## Step 1: Provision Database Services

### 1.1 Add PostgreSQL

```bash
railway add --database postgresql
```

This auto-provisions `DATABASE_URL` environment variable.

### 1.2 Add Redis

```bash
railway add --database redis
```

This auto-provisions `REDIS_URL` environment variable.

### 1.3 Verify Provisioning

```bash
railway variables
# Should show DATABASE_URL and REDIS_URL
```

---

## Step 2: Create API Service

### 2.1 Create Service

```bash
# Create new service for API
railway service create forj-api

# Link to this service
railway service link forj-api
```

### 2.2 Set Root Directory

```bash
# Tell Railway to build from packages/api
railway up --service forj-api
# Or use Railway dashboard: Settings > Root Directory = "packages/api"
```

### 2.3 Set Environment Variables

Generate encryption keys first:

```bash
# Generate locally
export JWT_SECRET=$(openssl rand -base64 32)
export CLOUDFLARE_ENCRYPTION_KEY=$(openssl rand -base64 32)
export GITHUB_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Show keys to copy
echo "JWT_SECRET=$JWT_SECRET"
echo "CLOUDFLARE_ENCRYPTION_KEY=$CLOUDFLARE_ENCRYPTION_KEY"
echo "GITHUB_ENCRYPTION_KEY=$GITHUB_ENCRYPTION_KEY"
```

Add variables to Railway:

```bash
# Core configuration
railway variables set NODE_ENV=production
railway variables set HOST=0.0.0.0
railway variables set PORT=3000
railway variables set TRUST_PROXY=true

# Security keys (use generated values above)
railway variables set JWT_SECRET="<your-generated-jwt-secret>"
railway variables set CLOUDFLARE_ENCRYPTION_KEY="<your-generated-cf-key>"
railway variables set GITHUB_ENCRYPTION_KEY="<your-generated-gh-key>"

# Mock auth (CRITICAL: must be false in production)
railway variables set ENABLE_MOCK_AUTH=false

# Namecheap (start with sandbox)
railway variables set ENABLE_NAMECHEAP_ROUTES=true
railway variables set NAMECHEAP_API_USER="<your-username>"
railway variables set NAMECHEAP_API_KEY="<your-api-key>"
railway variables set NAMECHEAP_USERNAME="<your-username>"
railway variables set NAMECHEAP_CLIENT_IP="0.0.0.0"
railway variables set NAMECHEAP_SANDBOX=true

# GitHub OAuth App
railway variables set GITHUB_CLIENT_ID="<your-github-client-id>"
railway variables set GITHUB_CLIENT_SECRET="<your-github-client-secret>"

# Stripe (optional for testing)
railway variables set STRIPE_SECRET_KEY="sk_test_..."
railway variables set STRIPE_WEBHOOK_SECRET="whsec_..."
railway variables set STRIPE_PUBLISHABLE_KEY="pk_test_..."
railway variables set REQUIRE_PAYMENT=false

# Sentry monitoring
railway variables set SENTRY_DSN_API="<your-sentry-dsn>"
railway variables set SENTRY_ENVIRONMENT=production
railway variables set SENTRY_TRACES_SAMPLE_RATE=0.1

# Rate limiting
railway variables set RATE_LIMITING_ENABLED=true

# Bull Board (disable in production)
railway variables set ENABLE_BULL_BOARD=false
```

**Or use Railway Dashboard:**
1. Go to https://railway.com/project/56e0b66e-4e3d-4563-8343-f6589dce7ec2
2. Select `forj-api` service
3. Go to "Variables" tab
4. Add each variable above

### 2.4 Deploy API

```bash
railway up --service forj-api

# Or push via GitHub (if connected)
git push origin main
```

### 2.5 Verify API Deployment

```bash
# Get the public URL
railway domain

# Test health endpoint
curl https://forj-api.up.railway.app/health

# Expected response:
# {"success":true,"data":{"status":"healthy","timestamp":"2026-03-16T..."}}
```

---

## Step 3: Create Workers Service

### 3.1 Create Service

```bash
# Create new service for workers
railway service create forj-workers

# Link to this service
railway service link forj-workers
```

### 3.2 Set Root Directory

```bash
# Tell Railway to build from packages/workers
railway up --service forj-workers
# Or use Railway dashboard: Settings > Root Directory = "packages/workers"
```

### 3.3 Set Environment Variables

Workers need the same `DATABASE_URL` and `REDIS_URL` (auto-linked) plus:

```bash
# Core configuration
railway variables set NODE_ENV=production

# Encryption keys (MUST match API service)
railway variables set CLOUDFLARE_ENCRYPTION_KEY="<same-as-api>"
railway variables set GITHUB_ENCRYPTION_KEY="<same-as-api>"

# Worker concurrency
railway variables set DOMAIN_WORKER_CONCURRENCY=5

# Sentry monitoring
railway variables set SENTRY_DSN_WORKERS="<your-sentry-dsn>"
railway variables set SENTRY_ENVIRONMENT=production
```

### 3.4 Deploy Workers

```bash
railway up --service forj-workers
```

### 3.5 Verify Workers Deployment

```bash
# Check logs
railway logs --service forj-workers

# Expected output:
# [INFO] Starting BullMQ workers...
# [INFO] DomainWorker: Started
# [INFO] GitHubWorker: Started
# [INFO] CloudflareWorker: Started
# [INFO] DNSWorker: Started
```

---

## Step 4: Run Database Migrations

### 4.1 Connect to Railway Database

```bash
# Get DATABASE_URL from Railway
railway variables --service forj-api | grep DATABASE_URL

# Or use Railway CLI to run migrations directly
railway run --service forj-api npm run db:migrate -w packages/api
```

### 4.2 Verify Migrations

```bash
# Check migration status
railway run --service forj-api npm run db:migrate -w packages/api -- --list

# Expected output:
# ✓ 1741570800000_init-projects-table.cjs
# ✓ 1741915200000_create-users-table.cjs
# ✓ 1773363143000_alter-user-id-to-varchar.cjs
# ✓ 1773411143000_create-api-keys-table.cjs
```

---

## Step 5: Set Up Custom Domain (Optional)

### 5.1 Add Domain to API Service

```bash
# Add custom domain
railway domain add api.forj.sh --service forj-api
```

### 5.2 Configure DNS

Add CNAME record to your DNS provider:

```
Type: CNAME
Name: api
Value: forj-api.up.railway.app
```

Railway automatically provisions SSL certificate via Let's Encrypt.

---

## Step 6: Test Deployment

### 6.1 Health Check

```bash
curl https://forj-api.up.railway.app/health

# Expected: {"success":true,"data":{"status":"healthy"}}
```

### 6.2 Queue Status

```bash
curl https://forj-api.up.railway.app/queues

# Expected: JSON with queue stats (waiting, active, completed, failed)
```

### 6.3 Mock Auth Disabled

```bash
curl -X POST https://forj-api.up.railway.app/auth/cli \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test","cliVersion":"0.1.0"}'

# Expected: 404 Not Found (route should not exist in production)
```

### 6.4 Rate Limiting

```bash
# Test IP rate limiting
for i in {1..100}; do
  curl -s https://forj-api.up.railway.app/health | jq -r '.success'
done

# Expected: "true" for first ~60 requests, then 429 errors
```

---

## Step 7: Configure CLI to Use Railway API

### 7.1 Update CLI Configuration

```bash
# Build CLI locally
npm run build -w packages/cli

# Set API URL
export FORJ_API_URL=https://forj-api.up.railway.app

# Or edit ~/.forj/config.json
cat > ~/.forj/config.json <<EOF
{
  "apiUrl": "https://forj-api.up.railway.app",
  "token": null
}
EOF
```

### 7.2 Test CLI Connection

```bash
# Test version command
node packages/cli/dist/cli.js --version

# Test login (will need real auth implementation)
node packages/cli/dist/cli.js login
```

---

## Step 8: Monitor Deployment

### 8.1 Railway Dashboard

View real-time metrics:
- https://railway.com/project/56e0b66e-4e3d-4563-8343-f6589dce7ec2

Metrics available:
- CPU usage
- Memory usage
- Network traffic
- Deployment history
- Build logs

### 8.2 Sentry Dashboard

View error tracking:
- API: https://forj-sh.sentry.io/issues/?project=forj-api
- Workers: https://forj-sh.sentry.io/issues/?project=forj-workers

### 8.3 Log Streaming

```bash
# Stream API logs
railway logs --service forj-api --tail

# Stream worker logs
railway logs --service forj-workers --tail
```

---

## Troubleshooting

### Build Failures

**Problem:** "Cannot find module '@forj/shared'"

**Solution:** Ensure build command includes shared package:
```bash
npm run build -w packages/shared && npm run build -w packages/api
```

### Database Connection Issues

**Problem:** "Connection refused" or "ECONNREFUSED"

**Solution:** Verify `DATABASE_URL` is set:
```bash
railway variables --service forj-api | grep DATABASE_URL
```

### Redis Connection Issues

**Problem:** "Redis connection timeout"

**Solution:** Verify `REDIS_URL` is set:
```bash
railway variables --service forj-api | grep REDIS_URL
```

### Workers Not Processing Jobs

**Problem:** Jobs stuck in "waiting" state

**Solution:**
1. Check workers are running: `railway logs --service forj-workers`
2. Verify `REDIS_URL` matches between API and Workers
3. Check worker concurrency: `DOMAIN_WORKER_CONCURRENCY=5`

### Environment Variable Mismatch

**Problem:** Encryption/decryption errors

**Solution:** Ensure encryption keys match between API and Workers:
```bash
railway variables --service forj-api | grep ENCRYPTION_KEY
railway variables --service forj-workers | grep ENCRYPTION_KEY
# Values must be identical
```

---

## Production Checklist

Before launching publicly:

- [ ] PostgreSQL provisioned and migrations run
- [ ] Redis provisioned
- [ ] API service deployed and health check passing
- [ ] Workers service deployed and processing jobs
- [ ] All environment variables set correctly
- [ ] `ENABLE_MOCK_AUTH=false` in production
- [ ] `TRUST_PROXY=true` for Railway
- [ ] `NAMECHEAP_SANDBOX=true` for initial testing (switch to false later)
- [ ] Sentry DSNs configured for API and Workers
- [ ] Rate limiting enabled
- [ ] Custom domain configured (optional)
- [ ] SSL certificate active
- [ ] CLI tested against Railway API
- [ ] End-to-end provisioning flow tested

---

## Scaling

### Horizontal Scaling

**API Service:**
```bash
# Scale to multiple instances (Railway Pro plan)
# Go to Dashboard > forj-api > Settings > Replicas
# Set to 2-3 instances
```

**Workers Service:**
```bash
# Workers auto-scale with job queue
# Start with 1 instance
# Monitor queue depth and scale if needed
```

### Vertical Scaling

Railway auto-scales resources based on usage. Monitor via dashboard:
- CPU usage > 80% → Consider upgrading plan
- Memory usage > 80% → Review for memory leaks
- Build time > 5 min → Optimize build process

---

## Cost Estimation

**Railway Pricing (as of March 2026):**

- **Starter Plan:** $5/month (500 hours)
- **Pro Plan:** $20/month (unlimited hours)

**Estimated monthly cost for Forj MVP:**
- API Service: ~$10-15/month
- Workers Service: ~$5-10/month
- PostgreSQL: ~$5/month (Neon serverless)
- Redis: ~$5/month (Upstash)
- **Total:** ~$25-35/month

**Optimization tips:**
1. Use Railway Starter plan for testing
2. Upgrade to Pro when launching publicly
3. Monitor usage via Railway dashboard
4. Set up billing alerts

---

## Next Steps

After Railway deployment:

1. **Test full provisioning flow** (see RAILWAY_DEPLOYMENT.md Step 6)
2. **Configure Sentry alerts** (`npm run configure-sentry-alerts`)
3. **Set up uptime monitoring** (BetterUptime, Checkly)
4. **Switch to production Namecheap** (`NAMECHEAP_SANDBOX=false`)
5. **Enable payment requirement** (`REQUIRE_PAYMENT=true`)
6. **Publish CLI to npm** (`npm publish`)
7. **Launch! 🚀**

---

## Support

- **Railway Docs:** https://docs.railway.com
- **Railway Discord:** https://discord.gg/railway
- **Forj Issues:** https://github.com/forj-sh/forj/issues
