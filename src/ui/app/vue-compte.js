// KOTONOHA 2.0 · écran Compte (PX-05, 04 §15.4 ; ET-20 à ET-27). Sans service de comptes configuré, l'écran le dit et ne demande aucun mot
// de passe. Avec un port distant (tests), il montre l'état de synchronisation du module. Les comptes V2 sont distincts de ceux de la V1 (Q-36).
import { h } from './dom.js';
import { bouton, note, lien } from './composants-app.js';
import { hashPour } from './routeur.js';

export function vueCompte(ctx) {
  const racine = h('div', { class: 'vue vue-compte' });
  const etat = h('p', { class: 'etat-compte', id: 'compte-etat', role: 'status' });
  const zone = h('div', {});
  racine.append(h('h1', { tabindex: '-1' }, 'Compte et second appareil'),
    h('p', {}, 'Votre compte de la version précédente n’est pas utilisé ici ; vos données sont reprises par la migration.'),
    h('p', {}, 'Aucune donnée locale n’est effacée à la connexion.'), etat, zone);
  const maj = async () => {
    const s = ctx.sync;
    if (!ctx.remote || !s) {
      etat.replaceChildren(h('strong', {}, 'Sur cet appareil uniquement'));
      zone.replaceChildren(note({ type: 'info', texte: 'La connexion à un compte n’est pas encore disponible dans cette version : le service de comptes n’est pas configuré. Aucun mot de passe n’est demandé ni envoyé. Votre travail est enregistré sur cet appareil ; créez une sauvegarde dans les réglages pour ne pas dépendre d’un seul appareil.' }),
        h('p', {}, lien(hashPour('reglages'), 'Aller aux réglages', 'btn btn-secondaire')));
      return;
    }
    etat.replaceChildren(h('strong', {}, await s.label()));
    zone.replaceChildren(h('p', {}, 'Votre travail sur cet appareil sera rattaché au compte ; sur un second appareil, il apparaît après la réconciliation. Un conflit de texte est toujours présenté côte à côte, jamais résolu en silence.'),
      h('div', { class: 'barre-actions' }, bouton('Synchroniser maintenant', 'btn-principal', async () => { await ctx.cycle(); await maj(); })),
      h('p', {}, lien(hashPour('effacement'), 'Effacement définitif des textes')));
  };
  maj();
  const off = ctx.sync?.on(() => { maj(); });
  return { titre: 'Compte', element: racine, maj, fin: () => off?.() };
}
