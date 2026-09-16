import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
// v0.30 票 06：styles.css（plan/starter/scenario 存量段）已全量迁 Tailwind 并销号，
// 全仓视觉语言自此只剩 index.css 一套 token 源。

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);