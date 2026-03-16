# Railway Quick Start Guide

**5-minute setup for Forj deployment**

## Prerequisites

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login to Railway
railway login

# Verify you're in the forj project
railway status
```

---

## Step 1: Create Services (5 commands)

```bash
# 1. Add PostgreSQL
railway add --database postgresql

# 2. Add Redis
railway add --database redis

# 3. Create API service
railway service create forj-api

# 4. Create Workers service
railway service create forj-workers

# 5. Verify services
railway service list
```

**Expected output:**
```
forj-api
forj-workers
postgresql
redis
```

---

## Step 2: Generate Secrets

```bash
# Run the setup script
./scripts/railway-setup.sh > railway-commands.txt

# This creates railway-commands.txt with all commands pre-filled
```

**IMPORTANT:** Save the generated keys securely! You'll need them.

---

## Step 3: Configure API Service

```bash
# Link to API service
railway service link forj-api

# Run the commands from railway-commands.txt (API section)
# Or set variables manually via Railway dashboard
```

**Critical variables to update in the commands:**
- `NAMECHEAP_API_USER` - Your Namecheap username
- `NAMECHEAP_API_KEY` - From Namecheap dashboard
- `GITHUB_CLIENT_ID` - From GitHub OAuth App
- `GITHUB_CLIENT_SECRET` - From GitHub OAuth App
- `SENTRY_DSN_API` - From Sentry dashboard

---

## Step 4: Configure Workers Service

```bash
# Link to Workers service
railway service link forj-workers

# Run the commands from railway-commands.txt (Workers section)
# Or set variables manually via Railway dashboard
```

**Critical variables to update:**
- `SENTRY_DSN_WORKERS` - From Sentry dashboard
- Encryption keys must match API service (already done if using script)

---

## Step 5: Deploy

```bash
# Deploy API
railway service link forj-api
railway up

# Deploy Workers
railway service link forj-workers
railway up

# Or trigger deployment via GitHub push
git push origin main
```

---

## Step 6: Run Migrations

```bash
# Run database migrations
railway service link forj-api
railway run npm run db:migrate -w packages/api

# Verify migrations
railway run npm run db:migrate -w packages/api -- --list
```

**Expected:** 4 migrations completed ✓

---

## Step 7: Test Deployment

```bash
# Get API URL
railway service link forj-api
railway domain

# Test health endpoint
curl https://forj-api-production.up.railway.app/health

# Expected: {"success":true,"data":{"status":"healthy"}}
```

---

## Step 8: Monitor

```bash
# Stream API logs
railway service link forj-api
railway logs --tail

# Stream Workers logs
railway service link forj-workers
railway logs --tail
```

---

## Troubleshooting

### "Service not found"

```bash
# List all services
railway service list

# Link to correct service
railway service link forj-api
```

### "Build failed"

```bash
# Check build logs
railway logs --service forj-api

# Common fix: Ensure root directory is set
# Dashboard > forj-api > Settings > Root Directory = "packages/api"
```

### "Database connection failed"

```bash
# Verify DATABASE_URL is set
railway variables | grep DATABASE_URL

# If missing, re-link database:
railway add --database postgresql
```

### "Workers not processing jobs"

```bash
# Ensure both services share same Redis
railway variables --service forj-api | grep REDIS_URL
railway variables --service forj-workers | grep REDIS_URL

# URLs should match
```

---

## Next Steps

✅ Services deployed
✅ Migrations run
✅ Health checks passing

**Now:**
1. Test CLI connection: See RAILWAY_DEPLOYMENT.md Step 7
2. Test full provisioning flow: See RAILWAY_DEPLOYMENT.md Step 6
3. Configure monitoring: `npm run configure-sentry-alerts`
4. Switch to production Namecheap: `NAMECHEAP_SANDBOX=false`
5. Launch! 🚀

---

## Full Guide

See **RAILWAY_DEPLOYMENT.md** for comprehensive deployment documentation.
