# Production Deployment Guide

**Last Updated**: March 11, 2026
**Target Environment**: Railway / Render / Fly.io
**Prerequisites**: Phase 5 complete, security review passed

---

## Overview

This guide covers deploying Forj to production with all services (API server, workers, Redis, Postgres). Recommended for Phase 7 launch readiness.

---

## Infrastructure Requirements

### Compute
- **API Server**: 1 CPU, 512MB RAM minimum (2 CPU, 1GB recommended)
- **Workers**: 1 CPU, 512MB RAM per worker type (can run in same process as API)
- **Runtime**: Node.js 18+ LTS

### Database
- **Postgres**: Neon Serverless (5GB free tier, scales to 10GB)
- **Connection Pooling**: PgBouncer or Neon's built-in pooling
- **Backups**: Daily automated backups with 7-day retention

### Cache/Queue
- **Redis**: Upstash (256MB free tier) or Railway Redis (1GB)
- **Persistence**: RDB snapshots enabled
- **Eviction**: allkeys-lru policy

### Storage Requirements
- **Database**: ~100MB for 1000 projects (grows linearly)
- **Redis**: ~50MB for 10,000 active jobs

---

## Deployment Options

### Option 1: Railway (Recommended for MVP)

**Pros**:
- Easy monorepo support
- Built-in Redis and Postgres
- GitHub integration for auto-deploy
- Free tier: $5 credit/month

**Cons**:
- Can get expensive at scale
- Less control over infrastructure

**Setup**:
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Add services
railway add --service postgres
railway add --service redis

# Deploy
railway up
```

### Option 2: Render

**Pros**:
- Simple pricing ($7/month for web service)
- Managed Postgres and Redis
- Auto-deploy from GitHub
- Good for small-medium traffic

**Cons**:
- Slower cold starts
- Less flexible than Railway

**Setup**:
```bash
# Create render.yaml
cat > render.yaml << EOF
services:
  - type: web
    name: forj-api
    env: node
    buildCommand: npm install && npm run build
    startCommand: npm run start -w packages/api
    envVars:
      - key: NODE_ENV
        value: production
EOF

# Connect GitHub repo at render.com dashboard
```

### Option 3: Fly.io

**Pros**:
- Global edge deployment
- Low latency worldwide
- Best performance
- Flexible pricing

**Cons**:
- More complex setup
- Requires Dockerfile
- Learning curve

**Setup**: See "Fly.io Deployment" section below

---

## Pre-Deployment Checklist

### 1. Code Preparation

- [ ] All tests passing: `npm test`
- [ ] Build succeeds: `npm run build`
- [ ] No TypeScript errors: `npm run type-check`
- [ ] Dependencies up to date: `npm audit`
- [ ] No critical vulnerabilities

### 2. Environment Variables

Review and set all required environment variables:

**Core Services** (REQUIRED):
```bash
DATABASE_URL=postgresql://user:pass@host:5432/forj_prod
REDIS_URL=redis://:password@host:6379
JWT_SECRET=<256-bit random secret>
NODE_ENV=production
```

**Namecheap** (REQUIRED for domain registration):
```bash
NAMECHEAP_API_USER=your_reseller_username
NAMECHEAP_API_KEY=<your_api_key>
NAMECHEAP_USERNAME=your_reseller_username
NAMECHEAP_CLIENT_IP=<your_server_ip>  # See note below about dynamic IPs
NAMECHEAP_SANDBOX=false  # IMPORTANT: use production API
ENABLE_NAMECHEAP_ROUTES=true
```

**IMPORTANT - IP Whitelisting Challenge**: Namecheap requires your server's outbound IP to be whitelisted. However, Railway, Render, and Fly.io use **dynamic or shared outbound IPs** on standard plans, which can cause API calls to fail. Solutions:
- **Railway**: Contact support to request a dedicated IP or use Railway's Pro plan
- **Render**: Use a NAT gateway or proxy with static IP (additional cost)
- **Fly.io**: Use Fly.io's [Anycast IP addresses](https://fly.io/docs/reference/services/#anycast) (requires Dedicated IP add-on ~$2/mo)
- **Alternative**: Use a proxy service (e.g., QuotaGuard, Fixie) that provides a static IP for outbound traffic

**Stripe** (REQUIRED for payments):
```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...  # Get from Stripe webhook endpoint
STRIPE_PUBLISHABLE_KEY=pk_live_...
```

**Workers** (OPTIONAL, tune for performance):
```bash
DOMAIN_WORKER_CONCURRENCY=5
GITHUB_WORKER_CONCURRENCY=10
CLOUDFLARE_WORKER_CONCURRENCY=10
DNS_WORKER_CONCURRENCY=5
```

**Features** (OPTIONAL):
```bash
LOG_LEVEL=info  # Use 'debug' for troubleshooting
RATE_LIMITING_ENABLED=true
ENABLE_BULL_BOARD=false  # NEVER enable in production (security risk)
```

### 3. External Service Setup

**Namecheap Reseller Account**:
1. Apply for reseller account at https://www.namecheap.com/reseller/
2. Deposit $50 minimum balance
3. Get API credentials from account dashboard
4. Whitelist server IP address
5. **Set NAMECHEAP_SANDBOX=false** for production

**Stripe Account**:
1. Create production Stripe account at https://stripe.com
2. Complete business verification
3. Create webhook endpoint: `https://api.forj.sh/webhooks/stripe`
4. Select events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`
5. Copy webhook secret to `STRIPE_WEBHOOK_SECRET`

**Neon Postgres**:
1. Create project at https://neon.tech
2. Select region (us-east-1 for US, eu-central-1 for EU)
3. Copy connection string to `DATABASE_URL`
4. Enable connection pooling
5. Set auto-suspend to "1 hour" (saves costs)

**Upstash Redis**:
1. Create database at https://upstash.com
2. Select region (same as Neon for low latency)
3. Copy connection string to `REDIS_URL`
4. Enable TLS
5. Set eviction policy to `allkeys-lru`

### 4. Database Migration

```bash
# Run migrations on production database
npm run db:migrate -w packages/api

# Verify tables created
psql $DATABASE_URL -c "\dt"

# Expected output:
#  Schema |      Name       | Type  |  Owner
# --------+-----------------+-------+----------
#  public | projects        | table | postgres
#  public | audit_log       | table | postgres
#  public | credentials     | table | postgres
```

---

## Deployment Steps

### Railway Deployment

1. **Create Railway Project**:
   ```bash
   railway init
   railway add --service postgres
   railway add --service redis
   ```

2. **Configure Environment Variables**:
   ```bash
   # Set all env vars via Railway dashboard or CLI
   railway variables set JWT_SECRET=$(openssl rand -base64 32)
   railway variables set NAMECHEAP_API_KEY=...
   railway variables set STRIPE_SECRET_KEY=...
   # ... set all other vars
   ```

3. **Deploy**:
   ```bash
   railway up
   ```

4. **Run Migrations**:
   ```bash
   railway run npm run db:migrate -w packages/api
   ```

5. **Verify Deployment**:
   ```bash
   curl https://your-app.railway.app/health
   ```

### Render Deployment

1. **Connect GitHub Repository**:
   - Go to https://dashboard.render.com
   - Click "New Web Service"
   - Connect forj-sh/forj repository

2. **Configure Service**:
   - **Name**: forj-api
   - **Environment**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start -w packages/api`
   - **Plan**: Starter ($7/month)

3. **Add Managed Services**:
   - Add PostgreSQL (Starter plan)
   - Add Redis (Free plan)

4. **Set Environment Variables**:
   - Copy all env vars from checklist above
   - Use `@DATABASE_URL` and `@REDIS_URL` for managed services

5. **Deploy**:
   - Click "Create Web Service"
   - Wait for build to complete

6. **Run Migrations**:
   ```bash
   # Via Render Shell
   npm run db:migrate -w packages/api
   ```

### Fly.io Deployment

1. **Create Dockerfile**:
   ```dockerfile
   # NOTE: This Dockerfile is designed for a monorepo structure.
   # Workspace dependencies (@forj/shared) are built and copied explicitly
   # to avoid broken symlinks in the final image.

   FROM node:18-alpine AS builder
   WORKDIR /app

   # Copy workspace root and all packages
   COPY package*.json ./
   COPY packages ./packages

   # Install all dependencies (includes workspace deps)
   RUN npm install

   # Build all packages (API depends on shared)
   RUN npm run build

   FROM node:18-alpine
   WORKDIR /app

   # Copy built artifacts for API and its workspace dependencies
   COPY --from=builder /app/packages/api/dist ./packages/api/dist
   COPY --from=builder /app/packages/api/package.json ./packages/api/
   COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
   COPY --from=builder /app/packages/shared/package.json ./packages/shared/

   # Copy root package files
   COPY --from=builder /app/package*.json ./

   # Install production dependencies only
   RUN npm install --production --workspaces

   EXPOSE 3000
   CMD ["node", "packages/api/dist/server.js"]
   ```

2. **Create fly.toml**:
   ```toml
   app = "forj-api"

   [build]
     dockerfile = "Dockerfile"

   [env]
     NODE_ENV = "production"

   [[services]]
     internal_port = 3000
     protocol = "tcp"

     [[services.ports]]
       handlers = ["http"]
       port = 80

     [[services.ports]]
       handlers = ["tls", "http"]
       port = 443
   ```

3. **Deploy**:
   ```bash
   fly launch
   fly secrets set JWT_SECRET=$(openssl rand -base64 32)
   fly secrets set NAMECHEAP_API_KEY=...
   fly deploy
   ```

---

## Post-Deployment Verification

### 1. Health Check

```bash
curl https://api.forj.sh/health
```

**Expected Response**:
```json
{
  "status": "healthy",
  "timestamp": "2026-03-11T22:00:00.000Z",
  "services": {
    "database": "connected",
    "redis": "connected",
    "queues": {
      "domain": { "waiting": 0, "active": 0, "completed": 0, "failed": 0 },
      "github": { "waiting": 0, "active": 0, "completed": 0, "failed": 0 },
      "cloudflare": { "waiting": 0, "active": 0, "completed": 0, "failed": 0 },
      "dns": { "waiting": 0, "active": 0, "completed": 0, "failed": 0 }
    }
  }
}
```

### 2. Test Authentication

```bash
# Get JWT token (use real auth endpoint in production)
TOKEN=$(curl -s https://api.forj.sh/auth/cli | jq -r '.data.token')

# Test authenticated endpoint
curl -H "Authorization: Bearer $TOKEN" \
  https://api.forj.sh/domains/check \
  -d '{"domains":["example.com"]}'
```

### 3. Test Domain Check (Production Namecheap)

```bash
curl -X POST https://api.forj.sh/domains/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domains": ["available-test-domain.com"]}'
```

**Expected**: Real Namecheap API response (not mock data)

### 4. Test Stripe Webhook

```bash
# Use Stripe CLI to forward webhooks to production
stripe listen --forward-to https://api.forj.sh/webhooks/stripe

# Trigger test event
stripe trigger checkout.session.completed
```

**Expected**: No signature verification errors in logs

### 5. Monitor Logs

```bash
# Railway
railway logs

# Render
# View logs in dashboard

# Fly.io
fly logs
```

**Look for**:
- ✅ "Server listening at https://..."
- ✅ "Redis connection successful"
- ✅ "Database connected"
- ✅ "Namecheap domain routes registered (production mode)"
- ❌ No error stack traces
- ❌ No "ECONNREFUSED" errors

---

## Monitoring Setup

### Application Metrics

**Recommended**: Prometheus + Grafana

1. **Install Prometheus Client**:
   ```bash
   npm install prom-client
   ```

2. **Add Metrics Endpoint**:
   ```typescript
   // packages/api/src/routes/metrics.ts
   import promClient from 'prom-client';

   const register = new promClient.Registry();
   promClient.collectDefaultMetrics({ register });

   server.get('/metrics', async (request, reply) => {
     reply.type('text/plain');
     return await register.metrics();
   });
   ```

3. **Configure Grafana**:
   - Add Prometheus data source
   - Import dashboard template
   - Set up alerts

**Key Metrics to Track**:
- HTTP request rate (by endpoint)
- HTTP error rate (4xx, 5xx)
- Request duration (p50, p95, p99)
- BullMQ job processing time
- Redis memory usage
- Database connection pool size

### Error Tracking

**Recommended**: Sentry

1. **Install Sentry SDK**:
   ```bash
   npm install @sentry/node
   ```

2. **Initialize in API Server**:
   ```typescript
   import * as Sentry from '@sentry/node';

   Sentry.init({
     dsn: process.env.SENTRY_DSN,
     environment: process.env.NODE_ENV,
     tracesSampleRate: 0.1,
   });

   server.addHook('onError', async (request, reply, error) => {
     Sentry.captureException(error);
   });
   ```

3. **Set Alerts**:
   - Email on new issues
   - Slack notification for critical errors
   - Alert on error rate > 1%

### Uptime Monitoring

**Recommended**: UptimeRobot or Better Uptime

1. **Create HTTP Monitor**:
   - URL: `https://api.forj.sh/health`
   - Interval: 5 minutes
   - Timeout: 30 seconds

2. **Set Alerts**:
   - Email on downtime
   - SMS for > 5 minute outages
   - Slack notification

---

## Scaling Considerations

### Horizontal Scaling (Multiple API Instances)

If traffic exceeds single instance capacity:

1. **Load Balancer**:
   - Railway/Render: Auto-scaling built-in
   - Fly.io: Use `fly scale count 3`

2. **Sticky Sessions**:
   - Not required (API is stateless)
   - SSE connections should use connection pooling

3. **Worker Scaling**:
   - Deploy workers separately from API
   - Increase concurrency: `DOMAIN_WORKER_CONCURRENCY=10`

### Vertical Scaling (Larger Instances)

**When to scale up**:
- CPU usage > 80% sustained
- Memory usage > 90%
- Request latency > 500ms p95

**How to scale**:
```bash
# Railway
railway scale --cpu 2 --memory 2GB

# Render
# Upgrade plan in dashboard

# Fly.io
fly scale vm shared-cpu-2x
```

### Database Scaling

**Neon Auto-Scaling**:
- Automatic scaling to 10GB (free tier)
- Upgrade to Pro for unlimited scaling

**Connection Pooling**:
```typescript
// Increase pool size if needed
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Default: 10
});
```

### Redis Scaling

**Upstash Auto-Scaling**:
- Automatic scaling to 256MB (free tier)
- Upgrade to Pay-as-you-go for unlimited

**Eviction Policy**:
```bash
# Set in Upstash dashboard
CONFIG SET maxmemory-policy allkeys-lru
```

---

## Backup & Disaster Recovery

### Database Backups

**Neon Automated Backups**:
- Daily snapshots with 7-day retention (free tier)
- Point-in-time recovery up to 7 days (Pro tier)

**Manual Backup**:
```bash
# Backup production database
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Restore from backup
psql $DATABASE_URL < backup-20260311.sql
```

### Redis Backups

**Upstash RDB Snapshots**:
- Hourly snapshots with 24-hour retention
- Manual snapshots via dashboard

**Backup Strategy**:
- Redis is ephemeral (job queue state)
- No critical data in Redis
- Jobs can be retried if lost

### Application Backup

**GitHub as Source of Truth**:
- All code in version control
- Deploy from Git tags for rollback

**Rollback Procedure**:
```bash
# Railway
railway rollback

# Render
# Use "Manual Deploy" with specific commit

# Fly.io
fly releases
fly deploy --image registry.fly.io/forj-api:v1.2.3
```

---

## Security Hardening

### SSL/TLS

**Automatic HTTPS**:
- Railway: Auto-provisioned Let's Encrypt
- Render: Auto-provisioned SSL
- Fly.io: Auto-provisioned SSL

**Force HTTPS**:
```typescript
// IMPORTANT: This is only safe if your application is behind a trusted proxy
// (like a load balancer or reverse proxy) that correctly sets this header.
// Railway, Render, and Fly.io all provide trusted proxies that set x-forwarded-proto.
// If deploying elsewhere, verify your hosting platform provides this guarantee.
server.addHook('onRequest', async (request, reply) => {
  if (request.headers['x-forwarded-proto'] !== 'https') {
    return reply.redirect(301, `https://${request.hostname}${request.url}`);
  }
});
```

### Security Headers

```typescript
import helmet from '@fastify/helmet';

server.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
});
```

### CORS Configuration

```typescript
import cors from '@fastify/cors';

server.register(cors, {
  origin: ['https://forj.sh', 'https://app.forj.sh'],
  credentials: true,
});
```

### Rate Limiting

**⚠️ CRITICAL - MUST IMPLEMENT BEFORE LAUNCH**

See `docs/security-review.md` for implementation details.

---

## Troubleshooting

### Common Production Issues

**"Database connection pool exhausted"**
- Increase pool size: `max: 20` in Pool config
- Check for connection leaks (use `await client.release()`)
- Enable query timeout: `statement_timeout: 10000`

**"Redis memory limit exceeded"**
- Upgrade Upstash tier or switch to managed Redis
- Reduce job TTL: `removeOnComplete: { age: 3600 }`
- Enable eviction policy: `allkeys-lru`

**"Namecheap API rate limit exceeded"**
- Check rate limiter is enabled
- Reduce concurrent requests
- Implement exponential backoff

**"Workers not processing jobs"**
- Verify Redis connection
- Check worker logs for errors
- Restart worker processes

**"SSE connections dropping"**
- Increase server timeout
- Implement reconnection logic in CLI
- Use connection pooling

### Debug Commands

```bash
# Check environment variables
railway variables

# View recent logs
railway logs --tail 100

# Connect to production database
railway connect postgres

# Connect to production Redis
railway connect redis

# Run migrations manually
railway run npm run db:migrate -w packages/api
```

---

## Cost Estimates

### Railway (Recommended for MVP)

| Service | Plan | Cost |
|---------|------|------|
| API Server | Hobby | $5/month credit (then $0.20/hour) |
| Postgres | Plugin | $5/month |
| Redis | Plugin | $5/month |
| **Total** | | **~$15/month** (after free credit) |

### Render

| Service | Plan | Cost |
|---------|------|------|
| Web Service | Starter | $7/month |
| Postgres | Starter | $7/month |
| Redis | Free | $0 |
| **Total** | | **$14/month** |

### Fly.io (Best Performance)

| Service | Plan | Cost |
|---------|------|------|
| Shared CPU | 256MB RAM | $1.94/month |
| Postgres | 1GB | $0 (free tier) |
| Redis | Upstash 256MB | $0 (free tier) |
| **Total** | | **~$2/month** |

**Scaling Costs**:
- 1000 users: ~$50-100/month
- 10,000 users: ~$200-500/month
- 100,000 users: ~$1,000-3,000/month

---

## Production Checklist

### Before Launch

- [ ] All security issues from `docs/security-review.md` addressed
- [ ] Rate limiting implemented on all endpoints
- [ ] Audit logging enabled
- [ ] Error tracking configured (Sentry)
- [ ] Monitoring dashboards created (Grafana)
- [ ] Uptime monitoring enabled (UptimeRobot)
- [ ] Database backups verified
- [ ] SSL certificates auto-renew
- [ ] Security headers configured
- [ ] CORS restricted to production domains
- [ ] All env vars set in production
- [ ] Migrations run successfully
- [ ] Health check passing
- [ ] Test provisioning flow end-to-end
- [ ] Load testing completed (100 concurrent users)
- [ ] Penetration testing completed
- [ ] Incident response plan documented
- [ ] On-call rotation set up

### Launch Day

- [ ] Monitor error rates closely
- [ ] Watch for Redis memory spikes
- [ ] Track job queue lengths
- [ ] Monitor Namecheap API balance
- [ ] Check Stripe webhook delivery
- [ ] Verify SSE connections stable
- [ ] Test CLI auth flows
- [ ] Verify DNS health checker working

### Post-Launch

- [ ] Review first week metrics
- [ ] Address any performance bottlenecks
- [ ] Optimize slow queries
- [ ] Review error logs for patterns
- [ ] Update documentation based on issues
- [ ] Collect user feedback
- [ ] Plan Phase 6 features

---

## Support & Escalation

**Production Issues**:
1. Check health endpoint first
2. Review recent logs
3. Check Sentry for errors
4. Verify external service status (Namecheap, Stripe, Cloudflare)
5. Contact Railway/Render support if infrastructure issue

**On-Call Escalation**:
- **P0 (Critical)**: Complete outage, security breach
  - Response time: 15 minutes
  - Notification: SMS + Slack
- **P1 (High)**: Degraded performance, partial outage
  - Response time: 1 hour
  - Notification: Slack
- **P2 (Medium)**: Non-critical bugs, feature requests
  - Response time: 24 hours
  - Notification: Email

---

**Deployment Guide Version**: 1.0
**Last Updated**: March 11, 2026
**Next Review**: After Phase 7 launch
