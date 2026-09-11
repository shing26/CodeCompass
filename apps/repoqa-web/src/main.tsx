import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
// CM-04 起 chat/方案摘要/场景导览样式一直在，但从未挂进加载链（A02 review
// 实拍发现，monaco #12 同型隐性退化）——本票 CTA 按钮依赖其中 .plan-card-cta，
// 接线于此；视觉首秀由 A04 两视口截图核对验收。
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);