// Démonstration de Focus (PH-7). Page de développement, hors design system.
import { monterFocus } from '../src/ui/focus.js';

const focus = monterFocus(document.getElementById('focus'), { baseSons: '../sons/' });
globalThis.__focus = focus; // pour les tests navigateur

const theme = document.getElementById('theme');
theme.addEventListener('click', () => {
  const nuit = document.documentElement.getAttribute('data-theme') !== 'nuit';
  if (nuit) document.documentElement.setAttribute('data-theme', 'nuit'); else document.documentElement.removeAttribute('data-theme');
  theme.setAttribute('aria-pressed', String(nuit));
});
