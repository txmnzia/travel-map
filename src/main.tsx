import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// On iOS Safari, window.innerHeight (with viewport-fit=cover) reflects the
// true physical screen height, while CSS 100vh / clientHeight only reach the
// layout viewport. Drive #root height from JS so it always fills the screen.
const setAppHeight = () =>
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
setAppHeight();
window.addEventListener('resize', setAppHeight);
window.visualViewport?.addEventListener('resize', setAppHeight);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
