import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { migrateLegacy, seedIfEmpty, upgradeStoredData } from './db';
import { startCloud } from './sync/cloud';
import './styles.css';

const theme = localStorage.getItem('theme');
if (theme) document.documentElement.dataset.theme = theme;

migrateLegacy()
  .catch((e) => console.error('Migration from the old on-device database failed', e))
  .then(() => seedIfEmpty())
  .then(() => upgradeStoredData())
  .finally(() => {
  startCloud();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`));
}
// Ask the browser not to evict local data (photos, logs) under storage pressure.
navigator.storage?.persist?.();
