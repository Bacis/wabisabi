import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import './index.css';
// Side-effect import — fires loadFont() calls for every font available in
// the picker, so the Player can render any selection without a fallback flash.
import './lib/preloadFonts';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);
