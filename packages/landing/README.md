# @forj/landing

Marketing landing page for Forj — built with Vite + TypeScript.

## 🚀 Quick Start

```bash
# Install dependencies (from monorepo root)
npm install

# Run dev server
npm run dev -w packages/landing

# Build for production
npm run build -w packages/landing

# Preview production build
npm run preview -w packages/landing
```

## 📁 Structure

```
packages/landing/
├── public/              # Static assets
├── src/
│   ├── components/      # UI components
│   ├── services/        # API integrations (waitlist)
│   ├── styles/          # CSS modules
│   ├── utils/           # Utilities (validation, observers)
│   └── main.ts          # Entry point
├── index.html           # HTML entry
├── vite.config.ts       # Vite configuration
├── tsconfig.json        # TypeScript config
└── vercel.json          # Vercel deployment config
```

## 🛠️ Tech Stack

- **Build Tool:** Vite 5
- **Language:** TypeScript
- **Styling:** Vanilla CSS
- **Validation:** Native regex (no dependencies)
- **API:** Vercel serverless functions
- **Database:** Neon PostgreSQL (serverless)
- **Email:** Resend (optional confirmations)
- **Spam Protection:** Cloudflare Turnstile + rate limiting
- **Deployment:** Vercel

## 🔧 Environment Variables

Create a `.env.local` file in `packages/landing/`:

```bash
cp .env.local.example .env.local
```

### Development (Optional)

For local testing, all environment variables are optional. The form will work without them (just logs to console).

```env
# Optional - CAPTCHA spam protection
VITE_TURNSTILE_SITEKEY=your_site_key

# Optional - Server-side CAPTCHA verification
TURNSTILE_SECRET_KEY=your_secret_key

# Optional - Email confirmations
RESEND_API_KEY=your_resend_api_key

# Optional - Database storage (required for production)
DATABASE_URL=postgres://...
```

### Production (Required)

For production deployment, configure these in Vercel:

1. **Cloudflare Turnstile** (Recommended - spam protection)
   - Visit https://dash.cloudflare.com/ → Turnstile
   - Create a site
   - Add `VITE_TURNSTILE_SITEKEY` (public) and `TURNSTILE_SECRET_KEY` (secret) to Vercel

2. **Neon Database** (Required - stores signups)
   - Visit https://neon.tech → Create project
   - Copy connection string to `DATABASE_URL` in Vercel

3. **Resend** (Optional - email confirmations)
   - Visit https://resend.com/api-keys
   - Create API key
   - Add `RESEND_API_KEY` to Vercel

## 🚢 Deployment

### Vercel (Recommended)

1. **Connect Repository**
   - Import your GitHub repository to Vercel
   - Select `packages/landing` as the root directory

2. **Configure Environment Variables**
   - Add `DATABASE_URL` (required - Neon PostgreSQL connection string)
   - Add `VITE_TURNSTILE_SITEKEY` (optional - public CAPTCHA key)
   - Add `TURNSTILE_SECRET_KEY` (optional - secret CAPTCHA key)
   - Add `RESEND_API_KEY` (optional - email confirmations)

3. **Deploy**
   - Vercel will automatically detect Vite and configure the build
   - API routes in `/api` folder will be deployed as serverless functions
   - Your site will be live at `https://your-project.vercel.app`

### Manual Deployment

```bash
# Build for production
npm run build -w packages/landing

# Preview the production build locally
npm run preview -w packages/landing

# Deploy the dist/ folder to any static host
```

## 🔒 Spam Protection

The waitlist form includes multiple layers of spam protection:

- **Server-side rate limiting**: IP-based, 60-second cooldown between submissions
- **Disposable email blocking**: Blocks common disposable email domains
- **Email validation**: Server-side regex validation
- **Cloudflare Turnstile**: Privacy-friendly CAPTCHA (optional)
- **Client-side rate limiting**: Browser-based, 3 attempts per 60 seconds
- **Honeypot field**: Hidden input to catch bots

The form works without Turnstile - it's just an additional layer of protection.

## 📝 License

MIT
