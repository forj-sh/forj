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

Create a `.env.local` file:

```env
VITE_WEB3FORMS_KEY=your_web3forms_access_key
VITE_TURNSTILE_SITEKEY=your_cloudflare_turnstile_sitekey
```

## 📝 License

MIT
