/**
 * Forj Landing Page
 * Entry point for the marketing site
 */

import './styles/main.css';

// App initialization
console.log('🔨 forj landing page — initializing...');

// Main app container
const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App container not found');
}

// Placeholder content (will be replaced with component rendering)
app.innerHTML = `
  <div style="padding: 2rem; font-family: 'JetBrains Mono', monospace; color: #f0ede8;">
    <h1 style="font-family: 'Syne', sans-serif; font-size: 3rem; margin-bottom: 1rem;">
      forj <span style="font-family: 'Noto Sans JP'; font-size: 1rem; color: #888;">鍛冶場</span>
    </h1>
    <p>Vite + TypeScript setup complete!</p>
    <p style="color: #888; font-size: 0.875rem;">Ready for component conversion...</p>
  </div>
`;

console.log('✅ forj landing page — initialized');
