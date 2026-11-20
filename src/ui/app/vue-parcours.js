// KOTONOHA 2.0 · vues Accueil et Parcours N4, N3, N2 (PX-01, PX-02 ; ET-01, ET-05). L'état de chaque leçon vient du journal.
// Les trois niveaux viennent du corpus V1 (210 unités) ; leur niveau reste une estimation (Q-12), jamais un classement JLPT.
import { h } from './dom.js';
import { barre, lien } from './composants-app.js';
import { etatLecon, groupesParModule, prochaineLecon, LIBELLES_ETAT } from '../../core/parcours.js';
import { hashPour, NIVEAU_PREM1, NB_LECONS_PREM1, NIVEAUX_OUVERTS } from './routeur.js';

const NB = ' ';
const pastille = () => h('span', { class: 'prog-pastille', 'aria-hidden': 'true' });

function texteEtat(l, e) {
  return e.etat === 'en-cours' ? `en cours, ${e.faites} section${e.faites > 1 ? 's' : ''} sur ${e.total}` : LIBELLES_ETAT[e.etat];
}
const leconsDu = (ctx, niveau) => ctx.cat.lecons().filter((l) => l.niveau === niveau);

/** Niveau à reprendre : le premier niveau ouvert commencé et non terminé, sinon le premier non terminé. */
export function niveauCourant(ctx, prefs) {
  const etats = NIVEAUX_OUVERTS.map((n) => { const ls = leconsDu(ctx, n); return { n, ls, suite: prochaineLecon(ls, prefs), commence: ls.some((l) => etatLecon(l, prefs).etat !== 'non-commencee') }; });
  return (etats.find((e) => e.commence && e.suite) ?? etats.find((e) => e.suite) ?? etats[0]);
}

export function vueAccueil(ctx) {
  const racine = h('div', { class: 'vue vue-accueil' });
  const titre = h('h1', { tabindex: '-1' }, h('span', { lang: 'ja' }, '言の葉'), ' KOTONOHA');
  const zoneReprise = h('section', { class: 'carte', 'aria-labelledby': 'acc-reprise' });
  const zoneBilan = h('section', { class: 'carte', 'aria-labelledby': 'acc-bilan' });
  const total = NIVEAUX_OUVERTS.reduce((s, n) => s + leconsDu(ctx, n).length, 0);
  const rendre = () => {
    const prefs = ctx.prefs();
    const cour = niveauCourant(ctx, prefs);
    const lecons = cour.ls, suite = cour.suite;
    const commence = NIVEAUX_OUVERTS.some((n) => leconsDu(ctx, n).some((l) => etatLecon(l, prefs).etat !== 'non-commencee'));
    zoneReprise.replaceChildren(h('h2', { id: 'acc-reprise' }, commence ? 'Reprendre où vous en étiez' : 'Commencer'));
    if (!lecons.length) zoneReprise.append(h('p', {}, 'Aucune leçon à afficher pour l’instant.'));
    else if (!suite) zoneReprise.append(h('p', {}, `Vous avez terminé les ${total} leçons des niveaux N4, N3 et N2.`), lien(hashPour('parcours'), 'Revoir le parcours', 'btn btn-secondaire'));
    else zoneReprise.append(
      h('p', {}, commence ? `Prochaine leçon du parcours (niveau estimé ${cour.n})${NB}:` : `Vous n’avez pas encore commencé. La première leçon vous attend${NB}:`),
      h('p', { class: 'reprise-titre' }, `Leçon ${suite.numero} · ${suite.titre}`),
      lien(hashPour('lecon', suite.numero), commence ? `Reprendre la leçon ${suite.numero}` : `Commencer la leçon ${suite.numero}`, 'btn btn-principal'));
    zoneBilan.replaceChildren(h('h2', { id: 'acc-bilan' }, 'Votre progression'));
    for (const n of NIVEAUX_OUVERTS) {
      const ls = leconsDu(ctx, n);
      if (!ls.length) continue;
      const faites = ls.filter((l) => etatLecon(l, prefs).etat === 'terminee').length;
      zoneBilan.append(barre(`acc-prog-${n}`, `Leçons terminées, niveau ${n}`, faites, ls.length, `Niveau ${n}`).element,
        h('p', { class: 'aide-courte' }, lien(hashPour('parcours', n), `Voir le parcours ${n}`)));
    }
  };
  rendre();
  racine.append(titre,
    h('p', { class: 'chapeau' }, `Préparation gratuite à l’examen JLPT, en français. Cette version propose les niveaux N4, N3 et N2${NB}: `, `${total || NB_LECONS_PREM1} leçons de grammaire, de vocabulaire, de kanji, de lecture et d’écoute.`),
    h('p', {}, h('span', { class: 'etiquette' }, 'Niveaux estimés N4 à N2')),
    zoneReprise, zoneBilan,
    h('p', {}, lien('#/positionnement', 'Faire le point sur mon niveau')),
    h('p', {}, 'Vous débutez ? ', lien('#/kana', 'Les kana')),
    h('section', { class: 'carte', 'aria-labelledby': 'acc-limites' }, h('h2', { id: 'acc-limites' }, 'Ce que cette version ne fait pas encore'),
      h('ul', {}, h('li', {}, 'Les exercices notés : ils ne sont proposés que pour un contenu dont le niveau est vérifié par deux repères indépendants, et aucun ne l’est pour l’instant. L’étude personnelle (dans les réglages) donne accès aux exercices, avec un niveau estimé et non certifié.'),
        h('li', {}, 'Les révisions hors étude personnelle : elles n’ont rien à proposer tant qu’aucun exercice vérifié n’est disponible.'),
        h('li', {}, 'Les niveaux N5 et N1, et les examens blancs.'),
        h('li', {}, 'La connexion à un compte : votre travail reste sur cet appareil.'))));
  return { titre: 'Accueil', element: racine, maj: rendre };
}

/** @param {any} ctx @param {{niveau?: string}} [r] */
export function vueParcours(ctx, r = {}) {
  const niv = NIVEAUX_OUVERTS.includes(r.niveau) ? r.niveau : NIVEAU_PREM1;
  const racine = h('div', { class: 'vue vue-parcours' });
  const groupes = groupesParModule(ctx.cat, ctx.modules, niv);
  const niveau = ctx.cat.niveaux[niv];
  const resume = h('div', { class: 'carte' });
  const liste = h('div', { class: 'modules' });
  const onglets = h('nav', { class: 'niveaux', 'aria-label': 'Niveaux du parcours' },
    h('ul', { class: 'barre-actions' }, ...NIVEAUX_OUVERTS.map((n) => h('li', {}, h('a', { class: `btn ${n === niv ? 'btn-principal' : 'btn-secondaire'}`, href: hashPour('parcours', n), ...(n === niv ? { 'aria-current': 'page' } : {}) }, `Niveau ${n}`)))));
  racine.append(h('h1', { tabindex: '-1' }, `Parcours ${niv}`), onglets,
    h('p', { class: 'chapeau' }, niveau ? niveau.goal : `Les leçons du niveau ${niv}.`),
    h('p', {}, h('span', { class: 'etiquette' }, `Niveau estimé ${niv}`), ' ', h('span', { class: 'aide-courte' }, 'Estimation tirée du contenu d’origine, pas un classement JLPT.')),
    resume, liste);
  const rendre = () => {
    const prefs = ctx.prefs(), toutes = groupes.flatMap((g) => g.lecons);
    resume.replaceChildren();
    liste.replaceChildren();
    if (!toutes.length) { liste.append(h('p', { class: 'vide' }, 'Aucune leçon à afficher pour l’instant. Rechargez la page ; si le problème continue, vos données ne sont pas touchées.')); return; }
    const faites = toutes.filter((l) => etatLecon(l, prefs).etat === 'terminee').length;
    resume.append(barre('par-prog', 'Leçons terminées', faites, toutes.length, 'Leçons terminées').element);
    if (faites === 0 && !toutes.some((l) => etatLecon(l, prefs).etat === 'en-cours')) resume.append(h('p', {}, `Vous n’avez pas encore commencé ce niveau. Commencez par la leçon ${toutes[0].numero}${NB}: les états ci-dessous se mettront à jour au fur et à mesure.`));
    for (const g of groupes) {
      const id = `mod-${g.module}`;
      const fait = g.lecons.filter((l) => etatLecon(l, prefs).etat === 'terminee').length;
      liste.append(h('section', { class: 'module', 'aria-labelledby': id },
        h('h2', { id }, `Module ${g.module + 1} · ${g.nom}`, h('span', { class: 'module-bilan' }, ` ${fait} sur ${g.lecons.length}`)),
        h('ol', { class: 'prog-segments lecons' }, ...g.lecons.map((l) => {
          const e = etatLecon(l, prefs);
          return h('li', { dataset: { etat: e.etat }, class: 'lecon-ligne' }, pastille(e.etat),
            h('a', { class: 'lnk', href: hashPour('lecon', l.numero) }, h('span', { class: 'nom-lecon' }, `Leçon ${l.numero} · ${l.titre}`), h('span', { class: 'kds-masque' }, ` : ${texteEtat(l, e)}`)),
            h('span', { class: 'prog-etat', 'aria-hidden': 'true' }, texteEtat(l, e)));
        }))));
    }
  };
  rendre();
  return { titre: `Parcours ${niv}`, element: racine, maj: rendre };
}
