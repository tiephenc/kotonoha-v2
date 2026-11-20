// KOTONOHA 2.0 · assemblage des composants du design system (KDS, scripts classiques) pour les écrans.
import { h } from './dom.js';

/** C-CHK interrupteur : <button role="switch">, nom accessible = libellé ; l'état écrit est décoratif (aria-hidden). */
export function interrupteur(id, libelle, actif, surChangement) {
  const b = h('button', { id, class: 'sw', type: 'button', role: 'switch', 'aria-checked': actif ? 'true' : 'false' },
    h('span', { class: 'sw-piste', 'aria-hidden': 'true' }, h('span', { class: 'sw-curseur' })),
    h('span', { class: 'sw-libelle' }, libelle), h('span', { class: 'sw-etat', 'aria-hidden': 'true' }));
  const k = window.KDS.interrupteur(b, surChangement);
  return { element: b, get actif() { return k.actif; }, regler(on) { b.setAttribute('aria-checked', String(!!on)); b.querySelector('.sw-etat').textContent = on ? 'Activé' : 'Désactivé'; } };
}
/** C-CHK case à cocher native avec sa boîte visible. */
export function caseACocher(id, libelle, cochee, surChangement) {
  const input = h('input', { id, type: 'checkbox', class: 'chk-input' });
  input.checked = !!cochee;
  input.addEventListener('change', () => surChangement(input.checked, input));
  return { element: h('label', { class: 'chk chk-case', for: id }, input, h('span', { class: 'chk-boite', 'aria-hidden': 'true' }), h('span', {}, libelle)), input };
}
/** C-PROG : barre de progression nommée, texte visible identique à aria-valuetext. */
export function barre(id, titre, n, max, unite) {
  const valeur = h('span', { class: 'prog-valeur', id: `${id}-texte` });
  const el = h('div', { class: 'prog' }, h('div', { class: 'prog-entete' }, h('span', { id: `${id}-titre` }, titre), valeur),
    h('div', { class: 'prog-barre', id, 'aria-labelledby': `${id}-titre`, dataset: { texte: `${id}-texte` } }, h('span', { class: 'prog-rempli' })));
  const b = el.querySelector('.prog-barre');
  const maj = (v, m) => window.KDS.progression(b, v, m, { unite });
  maj(n, max);
  return { element: el, maj };
}
/** Lien de navigation interne (adresse par hash). */
export const lien = (hash, texte, classe = 'lnk') => h('a', { class: classe, href: hash }, texte);
export const bouton = (texte, classe, run) => { const b = h('button', { type: 'button', class: `btn ${classe}` }, texte); if (run) window.KDS.action(b, run); return b; };
import { fr } from './dom.js';
/** C-NOTE avec typographie française des textes. */
export const note = (o) => window.KDS.note({ ...o, texte: typeof o.texte === 'string' ? fr(o.texte) : o.texte });
/** Message en ligne (C-NOTE) : zone `#<id>-retour` requise. */
export const ligne = (cible, o) => window.KDS.messageEnLigne(cible, { ...o, texte: typeof o.texte === 'string' ? fr(o.texte) : o.texte });
