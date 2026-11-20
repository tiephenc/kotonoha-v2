// KOTONOHA 2.0 · encart « Dans vos fiches Anki » d'une leçon : mots et kanji de la leçon présents dans les fiches importées
// (correspondance fiable seulement : écriture et lecture, ou kanji identique), avec leur état. Caché s'il n'y a rien à dire.
import { h, NB } from './dom.js';
import { lien } from './composants-app.js';
import { ankiDe } from './anki-etat.js';
import { jourLocal } from '../../core/anki.js';
import { hashPour } from './routeur.js';

const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n);

export function blocAnkiLecon(ctx, l) {
  const bloc = h('aside', { class: 'carte anki-lecon', id: 'lecon-anki', 'aria-labelledby': 'lecon-anki-titre', hidden: true });
  (async () => {
    try {
      const A = ankiDe(ctx);
      if (await A.vide()) return;
      const par = await A.parElement();
      const mots = l.vocabulaire.filter((v) => par.has(v.loc)), kanji = l.kanji.filter((k) => par.has(k.loc));
      if (!mots.length && !kanji.length) return;
      const items = [...new Set([...mots, ...kanji].flatMap((x) => par.get(x.loc)))];
      const jour = jourLocal(ctx.maintenant());
      const maitrisees = items.filter((i) => i.etat.maitrisee).length;
      const dues = items.filter((i) => (i.etat.statut === 'revision' || i.etat.statut === 'apprentissage') && i.etat.due !== null && i.etat.due <= jour).length;
      const parts = [];
      if (l.vocabulaire.length) parts.push(`${fmt(mots.length)} des ${fmt(l.vocabulaire.length)} mots`);
      if (l.kanji.length) parts.push(`${fmt(kanji.length)} des ${fmt(l.kanji.length)} kanji`);
      bloc.replaceChildren(h('h2', { id: 'lecon-anki-titre' }, 'Dans vos fiches Anki'),
        h('p', {}, `${parts.join(' et ')} de cette leçon sont dans vos fiches${NB}: ${fmt(maitrisees)} maîtrisée${maitrisees > 1 ? 's' : ''}${dues ? `, ${fmt(dues)} à revoir aujourd’hui` : ''}.`),
        h('p', {}, lien(hashPour('anki'), 'Réviser mes fiches Anki')));
      bloc.hidden = false;
    } catch { /* encart facultatif : la leçon reste entière */ }
  })();
  return bloc;
}
