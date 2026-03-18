import '../styles/main.css';
import { html } from '../utils/dom';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App container not found');

app.appendChild(html`
  <div class="status-page">
    <a href="/" class="status-logo">forj 鍛冶場</a>
    <div class="status-card">
      <div class="status-icon status-icon--cancel">&#10005;</div>
      <h1>Payment cancelled</h1>
      <p>No charges were made. You can restart the provisioning process from your terminal at any time.</p>
      <p class="status-hint">Run <code>forj init</code> to try again.</p>
    </div>
    <a href="/" class="status-link">Back to forj.sh</a>
  </div>
`);
