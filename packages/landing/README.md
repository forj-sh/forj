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
- **Styling:** CSS Modules
- **Validation:** Zod
- **Email Backend:** Web3Forms
- **Spam Protection:** Cloudflare Turnstile + Honeypot
- **Deployment:** Vercel

## 🔧 Environment Variables

Create a `.env.local` file in `packages/landing/`:

```bash
cp .env.local.example .env.local
```

Then update with your actual keys:

```env
VITE_WEB3FORMS_KEY=your_web3forms_access_key
VITE_TURNSTILE_SITEKEY=your_cloudflare_turnstile_sitekey
```

### Getting API Keys

**Web3Forms** (Free - Required for waitlist)
1. Visit https://web3forms.com
2. Sign up with your email
3. You'll receive an access key immediately
4. Add it to `.env.local`

**Cloudflare Turnstile** (Free - Optional for spam protection)
1. Visit https://dash.cloudflare.com/
2. Create an account if needed
3. Navigate to Turnstile section
4. Create a new site
5. Copy the site key to `.env.local`

## 🚢 Deployment

### Vercel (Recommended)

1. **Connect Repository**
   - Import your GitHub repository to Vercel
   - Select `packages/landing` as the root directory

2. **Configure Environment Variables**
   - Add `VITE_WEB3FORMS_KEY` (required)
   - Add `VITE_TURNSTILE_SITEKEY` (optional)

3. **Deploy**
   - Vercel will automatically detect Vite and configure the build
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

- **Cloudflare Turnstile**: Privacy-friendly CAPTCHA (optional, requires sitekey)
- **Honeypot Field**: Hidden field to catch bots
- **Rate Limiting**: 3 submissions per minute per browser (localStorage-based)
- **Email Validation**: Zod schema validation

If Turnstile is not configured, the form will still work with honeypot + rate limiting.

## 📝 License

MIT
