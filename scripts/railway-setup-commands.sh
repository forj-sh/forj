#!/bin/bash
# Railway Setup Commands for Forj
# Generated: March 16, 2026
# Run each section in order

set -e

echo "=== Railway Setup for Forj ==="
echo ""
echo "This script will guide you through setting up Railway services."
echo "You'll need to run these commands manually (Railway CLI requires interactive input)."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}STEP 1: Create Database Services${NC}"
echo ""
echo -e "${BLUE}Run these commands:${NC}"
echo ""
echo "railway add"
echo "  → Select: Database"
echo "  → Select: PostgreSQL"
echo ""
echo "railway add"
echo "  → Select: Database"
echo "  → Select: Redis"
echo ""
echo -e "${YELLOW}Press Enter when databases are created...${NC}"
read -r

echo ""
echo -e "${GREEN}STEP 2: Create Application Services${NC}"
echo ""
echo -e "${BLUE}Run these commands:${NC}"
echo ""
echo "railway service create forj-api"
echo "railway service create forj-workers"
echo ""
echo -e "${YELLOW}Press Enter when services are created...${NC}"
read -r

echo ""
echo -e "${GREEN}STEP 3: Configure API Service${NC}"
echo ""
echo -e "${BLUE}Link to API service:${NC}"
echo "railway service"
echo "  → Select: forj-api"
echo ""
echo -e "${YELLOW}Press Enter when linked to forj-api...${NC}"
read -r

echo ""
echo -e "${BLUE}Setting environment variables for API service...${NC}"
echo ""

# Core configuration
railway variables set NODE_ENV=production
railway variables set HOST=0.0.0.0
railway variables set PORT=3000
railway variables set TRUST_PROXY=true

# Security keys (NEW - generated for production)
railway variables set JWT_SECRET="RCVMpT+5DbDFjLcMeqOo0soXLL+Q0dCcQBDJcnyfnfI="
railway variables set CLOUDFLARE_ENCRYPTION_KEY="uuxbL0JOUCydLK9sr5gEX8BBzAlcawIB1slQkAeaHIs="
railway variables set GITHUB_ENCRYPTION_KEY="JL72CXSs3Ekrd3bqdhy5eyJQj19AIXCLc41kgtd7KDc="
railway variables set ENABLE_MOCK_AUTH=false

# Namecheap (from .env - sandbox credentials)
railway variables set ENABLE_NAMECHEAP_ROUTES=true
railway variables set NAMECHEAP_API_USER="pcdkdsandbox"
railway variables set NAMECHEAP_API_KEY="751a16fcb4b14f9883e7bce1d95227c2"
railway variables set NAMECHEAP_USERNAME="pcdkdsandbox"
railway variables set NAMECHEAP_CLIENT_IP="0.0.0.0"
railway variables set NAMECHEAP_SANDBOX=true

# GitHub OAuth (from .env)
railway variables set GITHUB_CLIENT_ID="Ov23limj3X5oShoW7QWN"
railway variables set GITHUB_CLIENT_SECRET="96df800f5c3b8d41bfc1aa4db652b12a55333dd8"

# Stripe (from .env - test keys)
railway variables set STRIPE_SECRET_KEY="sk_test_51T9VCIRC9GeUjA6z0nJ25mxL724x3RephKxgFepPw6U3yerKKu0u21osfenMMmilt3Xa2PbrEuIuoIi5MPoRvbBC00PaOwp7Wh"
railway variables set STRIPE_WEBHOOK_SECRET="whsec_1df7cd7fb7047c24554862eaa7086b7dbd694a3092b16cfbb6cc55a045696426"
railway variables set STRIPE_PUBLISHABLE_KEY="pk_test_51T9VCIRC9GeUjA6znuTuwJAF7G0dp2nkkMhr6tbJOeHmEEqV3oNd6H5N9lbhgXYrnrtk9RZe47eWsSC7ABuABrQb00bdLY7msL"
railway variables set REQUIRE_PAYMENT=false

# Sentry (from .env)
railway variables set SENTRY_DSN_API="https://7dd97ec0955ca3ee00205fb39eb8ded0@o4511042868805632.ingest.us.sentry.io/4511042872541184"
railway variables set SENTRY_ENVIRONMENT=production
railway variables set SENTRY_TRACES_SAMPLE_RATE=0.1

# Rate limiting
railway variables set RATE_LIMITING_ENABLED=true
railway variables set ENABLE_BULL_BOARD=false

echo ""
echo -e "${GREEN}✅ API service configured!${NC}"
echo ""

echo ""
echo -e "${GREEN}STEP 4: Configure Workers Service${NC}"
echo ""
echo -e "${BLUE}Link to Workers service:${NC}"
echo "railway service"
echo "  → Select: forj-workers"
echo ""
echo -e "${YELLOW}Press Enter when linked to forj-workers...${NC}"
read -r

echo ""
echo -e "${BLUE}Setting environment variables for Workers service...${NC}"
echo ""

# Core configuration
railway variables set NODE_ENV=production

# Encryption keys (must match API service)
railway variables set CLOUDFLARE_ENCRYPTION_KEY="uuxbL0JOUCydLK9sr5gEX8BBzAlcawIB1slQkAeaHIs="
railway variables set GITHUB_ENCRYPTION_KEY="JL72CXSs3Ekrd3bqdhy5eyJQj19AIXCLc41kgtd7KDc="

# Worker configuration
railway variables set DOMAIN_WORKER_CONCURRENCY=5

# Sentry (from .env)
railway variables set SENTRY_DSN_WORKERS="https://833159a139cea08124c841435074d59c@o4511042868805632.ingest.us.sentry.io/4511042877456384"
railway variables set SENTRY_ENVIRONMENT=production

echo ""
echo -e "${GREEN}✅ Workers service configured!${NC}"
echo ""

echo ""
echo -e "${GREEN}STEP 5: Verify Configuration${NC}"
echo ""
echo -e "${BLUE}Check API variables:${NC}"
echo "railway service"
echo "  → Select: forj-api"
echo "railway variables"
echo ""
echo -e "${BLUE}Check Workers variables:${NC}"
echo "railway service"
echo "  → Select: forj-workers"
echo "railway variables"
echo ""

echo ""
echo -e "${GREEN}=== Setup Complete! ===${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Deploy API: railway up --service forj-api"
echo "2. Deploy Workers: railway up --service forj-workers"
echo "3. Run migrations: railway run --service forj-api npm run db:migrate -w packages/api"
echo "4. Test: curl \$(railway domain --service forj-api)/health"
echo ""
echo "See RAILWAY_DEPLOYMENT.md for full deployment guide"
