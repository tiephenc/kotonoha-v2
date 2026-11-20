// KOTONOHA 2.0 · vue Focus (PH-4 « navigation Focus ») : le minuteur de concentration (PH-7) dans la coquille, route `#/focus`.
// Le module `src/ui/focus.js` n'est pas réécrit : on le monte dans la zone de la vue et on le démonte à la sortie (`fin`).
// Aucun contenu scolaire, aucun compte à rebours ajouté : l'affichage et l'état viennent du module, enregistrés sous `kotonoha2.focus.v1`.
import { h } from './dom.js';
import { hashPour } from './routeur.js';
import { monterFocus, VUE_FOCUS } from '../focus.js';

/** Vue Focus. `monter` : injectable pour les tests (défaut : le vrai module). */
export function vueFocus(ctx, { monter = monterFocus } = {}) {
  const zone = h('div', { class: 'vue-focus-zone' });
  const element = h('div', { class: 'vue vue-focus' },
    h('h1', { tabindex: '-1' }, VUE_FOCUS.titre),
    h('p', { class: 'aide-courte' }, 'Un minuteur de concentration, sans score ni série. Les sons ne se lancent que sur votre demande.'),
    h('p', { class: 'aide-courte' }, 'Le carillon et la notification de fin ne fonctionnent que lorsque cette page est ouverte. Ailleurs dans l’application, le bloc continue et sa fin vous est indiquée à votre retour.'),
    zone);
  // La zone est montée tout de suite : le module ne lit jamais le document pour trouver sa racine, et l'état enregistré est repris.
  const instance = monter(zone, { baseSons: new URL('../../../sons/', import.meta.url).href, ouvrirPause: () => { location.hash = hashPour('pause'); } });
  return { cle: 'focus', titre: VUE_FOCUS.titre, element, fin: () => instance.detruire(), instance };
}
