import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Suppress and handle Vercel live toolbar / COEP blocked script errors gracefully
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (event.filename && (event.filename.includes('vercel.live') || event.filename.includes('_next-live'))) {
      event.preventDefault();
      return true;
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reasonStr = String(event.reason ?? '');
    if (
      reasonStr.includes('vercel.live') ||
      reasonStr.includes('_next-live') ||
      reasonStr.includes("reading 'length'")
    ) {
      event.preventDefault();
    }
  });
}

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
} else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      for (const registration of registrations) {
        void registration.unregister();
      }
    })
    .catch(() => {
      // Ignore cleanup errors in restricted preview contexts
    });
}

createRoot(document.getElementById('root')!).render(<App />);
