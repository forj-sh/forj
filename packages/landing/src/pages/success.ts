import '../styles/main.css';
import { html } from '../utils/dom';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App container not found');

app.appendChild(html`
  <div class="status-page">
    <a href="/" class="status-logo">forj 鍛冶場</a>
    <div class="status-card">
      <div class="status-icon status-icon--success">&#10003;</div>
      <h1>Payment successful</h1>
      <p>Your domain is being provisioned. Head back to your terminal — the CLI is streaming progress in real time.</p>
      <p class="status-hint">You can close this tab.</p>
    </div>
    <a href="/" class="status-link">Back to forj.sh</a>
  </div>
`);
