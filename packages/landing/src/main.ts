/**
 * Forj Landing Page
 * Entry point for the marketing site
 */

import './styles/main.css';
import './styles/waitlist.css';
import { Nav } from './components/Nav';
import { Hero } from './components/Hero';
import { Terminal } from './components/Terminal';
import { LogosStrip } from './components/LogosStrip';
import { Features } from './components/Features';
import { APISection } from './components/APISection';
import { WaitlistForm } from './components/WaitlistForm';
import { Footer } from './components/Footer';
import { initRevealObserver } from './utils/reveal-observer';

// App initialization
console.log('🔨 forj landing page — initializing...');

// Main app container
const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App container not found');
}

// Render all components
app.appendChild(Nav());
app.appendChild(Hero());
app.appendChild(Terminal());
app.appendChild(LogosStrip());
app.appendChild(Features());
app.appendChild(APISection());
app.appendChild(WaitlistForm());
app.appendChild(Footer());

// Initialize scroll reveal observer
initRevealObserver();

console.log('✅ forj landing page — initialized');
