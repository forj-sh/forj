# Railway Setup Summary

**Status:** ✅ Ready for deployment
**Date:** March 16, 2026

---

## What's Been Prepared

### ✅ **1. Encryption Keys Generated**

New production-grade encryption keys have been generated:

```bash
JWT_SECRET=RCVMpT+5DbDFjLcMeqOo0soXLL+Q0dCcQBDJcnyfnfI=
CLOUDFLARE_ENCRYPTION_KEY=uuxbL0JOUCydLK9sr5gEX8BBzAlcawIB1slQkAeaHIs=
GITHUB_ENCRYPTION_KEY=JL72CXSs3Ekrd3bqdhy5eyJQj19AIXCLc41kgtd7KDc=
```

⚠️ **These are production keys - save them securely!**

### ✅ **2. Credentials Extracted from .env**

All existing credentials have been extracted and prepared for Railway:

- **Namecheap:** pcdkdsandbox (sandbox mode for testing)
- **GitHub OAuth:** Ov23limj3X5oShoW7QWN
- **Stripe:** Test mode keys
- **Sentry:** Production DSNs for API, Workers, and CLI

### ✅ **3. Railway Commands Generated**

Two files created with all Railway setup commands:

1. **`RAILWAY_COMMANDS.txt`** - Complete step-by-step command list
2. **`railway-setup-commands.sh`** - Interactive setup script

Both files contain the exact same commands with all credentials pre-filled.

### ✅ **4. Security Configuration**

Production security settings:

- `ENABLE_MOCK_AUTH=false` - Mock auth endpoint disabled
- `TRUST_PROXY=true` - Enables Railway/Cloudflare proxy headers
- `NAMECHEAP_SANDBOX=true` - Starts with sandbox for testing
- `REQUIRE_PAYMENT=false` - Disabled for initial testing
- `RATE_LIMITING_ENABLED=true` - Rate limiting active

---

## What You Need to Do

### **Option A: Follow Step-by-Step (Recommended)**

Open **`RAILWAY_COMMANDS.txt`** and run commands in order:

```bash
# View the commands
cat RAILWAY_COMMANDS.txt

# Follow sections 1-8
# Copy/paste each command into your terminal
```

### **Option B: Use Interactive Script**

```bash
# Run the interactive setup script
./railway-setup-commands.sh

# Follow the prompts
# Press Enter to continue through each step
```

---

## Quick Reference

### **Services to Create:**

1. PostgreSQL (Railway database)
2. Redis (Railway database)
3. forj-api (Application service)
4. forj-workers (Application service)

### **Environment Variables Set:**

**API Service (forj-api):**
- 22 environment variables
- All credentials pre-filled
- Production security enabled

**Workers Service (forj-workers):**
- 6 environment variables
- Encryption keys match API service
- Sentry monitoring enabled

---

## Deployment Flow

```
1. Create databases (PostgreSQL + Redis)
   └─> DATABASE_URL and REDIS_URL auto-provisioned

2. Create application services (forj-api + forj-workers)
   └─> Empty services ready for configuration

3. Configure API service
   └─> Set 22 environment variables
   └─> Link to PostgreSQL and Redis

4. Configure Workers service
   └─> Set 6 environment variables
   └─> Share same PostgreSQL and Redis

5. Deploy both services
   └─> railway up --service forj-api
   └─> railway up --service forj-workers

6. Run database migrations
   └─> railway run npm run db:migrate -w packages/api

7. Test deployment
   └─> curl https://<your-api-url>/health
```

---

## Testing Checklist

After deployment, test these flows:

### **1. Basic Health Check**
```bash
curl https://forj-api-production.up.railway.app/health
# Expected: {"success":true,"data":{"status":"healthy"}}
```

### **2. Mock Auth Disabled**
```bash
curl -X POST https://forj-api-production.up.railway.app/auth/cli
# Expected: 404 Not Found (secure!)
```

### **3. Rate Limiting Active**
```bash
for i in {1..100}; do curl -s https://forj-api-production.up.railway.app/health; done
# Expected: 429 Too Many Requests after ~60 requests
```

### **4. Namecheap Sandbox Connection**
```bash
# Build and test CLI
npm run build -w packages/cli
export FORJ_API_URL=https://forj-api-production.up.railway.app
node packages/cli/dist/cli.js add domain test-$(date +%s).com --check-only
# Expected: Domain availability check via Namecheap sandbox
```

### **5. Workers Processing Jobs**
```bash
# Check worker logs
railway service
# Select: forj-workers
railway logs --tail

# Expected output:
# [INFO] Starting BullMQ workers...
# [INFO] DomainWorker: Started
# [INFO] GitHubWorker: Started
# [INFO] CloudflareWorker: Started
# [INFO] DNSWorker: Started
```

---

## Files Created

```
RAILWAY_COMMANDS.txt              # All commands in order
railway-setup-commands.sh         # Interactive setup script
SETUP_SUMMARY.md                  # This file
```

Existing files:
```
RAILWAY_DEPLOYMENT.md             # Full deployment guide
RAILWAY_QUICKSTART.md             # 5-minute quick start
railway.toml                      # Root config
packages/api/railway.toml         # API service config
packages/workers/railway.toml     # Workers service config
nixpacks.toml                     # Nixpacks builder config
scripts/railway-setup.sh          # Key generation script
```

---

## Important Notes

### **Encryption Keys**

The new production keys are **different** from your .env file:

- .env `JWT_SECRET`: PjYtg+TY2h3lon61vvcBCTEfBikL4snye4wcA3pPW5k=
- Railway `JWT_SECRET`: RCVMpT+5DbDFjLcMeqOo0soXLL+Q0dCcQBDJcnyfnfI=

This is **intentional** for production security. Railway uses fresh keys.

### **Database URLs**

Railway auto-provisions these - **do not set manually:**

- `DATABASE_URL` - Auto-linked from PostgreSQL service
- `REDIS_URL` - Auto-linked from Redis service

### **Namecheap Client IP**

Set to `0.0.0.0` in Railway (allows any IP). Update in Namecheap dashboard:
1. Go to Profile → Tools → API Access
2. Add Railway's IP address to whitelist
3. Or keep `0.0.0.0` for development

---

## Support

- **Railway Commands:** See `RAILWAY_COMMANDS.txt`
- **Full Guide:** See `RAILWAY_DEPLOYMENT.md`
- **Quick Start:** See `RAILWAY_QUICKSTART.md`
- **Issues:** https://github.com/forj-sh/forj/issues

---

## Next Steps

1. ✅ Encryption keys generated
2. ✅ Credentials prepared
3. ✅ Commands ready
4. **→ Run commands from RAILWAY_COMMANDS.txt**
5. **→ Deploy services**
6. **→ Run migrations**
7. **→ Test deployment**
8. **→ Launch! 🚀**

Start here: **`cat RAILWAY_COMMANDS.txt`**
