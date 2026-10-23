import { THEME_KEY } from '../config.js';
import { icon } from '../lib/dom.js';

const META_COLOR = { dark: '#0b1613', light: '#EEE7E3' };

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function stored() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch { return null; }
}

export function applyTheme(theme, { persist = true } = {}) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[theme]);
  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ }
  }
}

/** Wires the toggle button. Follows the OS theme until the visitor picks one explicitly. */
export function initThemeToggle(button) {
  const paint = () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    button.replaceChildren(icon(next === 'light' ? 'sun' : 'moon'));
    button.setAttribute('aria-label', `Switch to ${next} theme`);
    button.setAttribute('title', `Switch to ${next} theme`);
  };
  paint();
  button.addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    paint();
  });
  const mq = window.matchMedia?.('(prefers-color-scheme: light)');
  mq?.addEventListener?.('change', (e) => {
    if (stored()) return;
    applyTheme(e.matches ? 'light' : 'dark', { persist: false });
    paint();
  });
}
