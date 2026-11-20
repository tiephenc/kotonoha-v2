// KOTONOHA 2.0 · point d'entrée de v2/index.html : démarre l'application réelle (aucun jeu de test, aucun serveur distant).
import { demarrer } from './coquille.js';

demarrer().catch((e) => {
  const vue = document.getElementById('vue');
  vue.replaceChildren();
  const t = document.createElement('h1'); t.tabIndex = -1; t.textContent = 'KOTONOHA ne peut pas démarrer';
  const p = document.createElement('p'); p.textContent = `Le démarrage a échoué : ${e.message}. Rechargez la page ; vos données ne sont pas touchées.`;
  vue.append(t, p); vue.removeAttribute('aria-busy'); document.documentElement.dataset.pret = 'erreur'; t.focus();
});
