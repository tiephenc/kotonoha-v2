// KOTONOHA 2.0 · vue Pause (écran de pause du Focus) : route `#/pause`, plein écran calme.
// Le composant `src/ui/pause.js` lit et fait évoluer l'état du Focus (même enregistrement) ; la coquille lui donne
// l'adresse où « Reprendre l'étude » ramène (la dernière vue d'étude quittée, `ctx.retourEtude`).
// Pendant l'affichage, `<html data-pause>` masque la barre de navigation (voir pause.css) ; `fin()` la rend.
import { h } from './dom.js';
import { monterPause, VUE_PAUSE } from '../pause.js';
import { hashPour } from './routeur.js';

export function vuePause(ctx, { monter = monterPause } = {}) {
  const zone = h('div', { class: 'vue-pause-zone' });
  const element = h('div', { class: 'vue vue-pause' }, h('h1', { tabindex: '-1', class: 'pz-h1' }, VUE_PAUSE.titre), zone);
  document.documentElement.dataset.pause = '1';
  const instance = monter(zone, {
    maintenant: ctx.maintenant,
    retour: ctx.retourEtude?.() ?? undefined,
    surMinuteur: () => { location.hash = hashPour('focus'); },
    baseSons: new URL('../../../sons/', import.meta.url).href,
  });
  return { cle: 'pause', titre: VUE_PAUSE.titre, element, fin: () => { instance.detruire(); delete document.documentElement.dataset.pause; }, instance };
}
