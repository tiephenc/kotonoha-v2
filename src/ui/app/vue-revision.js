// KOTONOHA 2.0 · écran Révisions (PX-04, EC-08 ; ET-01, ET-03, ET-08, ET-12). La file vient du moteur de consolidation (`preparerRevision`) ;
// aucun contenu au statut non admis n'est servi (Q-12 : `selectionner` en entraînement, sans contournement). L'arriéré n'est jamais
// imposé à l'écran (CU-14) : ni compteur de retard, ni « jours de retard ». Arrêter est toujours possible, sans perte.
import { h } from './dom.js';
import { bouton, note, lien } from './composants-app.js';
import { preparerRevision, dateDuJour, MESSAGE_VIDE } from '../../core/revision.js';
import { melangerItem } from '../../core/melange.js';
import { jouerSerie } from './vue-exercices.js';
import { graineSession } from './graine.js';
import { hashPour, NIVEAUX_OUVERTS } from './routeur.js';
import { lirePref } from '../../app/etude.js';
import { poolComplet, rattacherPerso } from '../../core/exercices.js';
import { chargerDonneesEcriture } from './donnees-ecriture.js';
import { ankiDe } from './anki-etat.js';
import { preparerSeanceAnki } from '../../core/anki.js';

const phraseEcheance = (p) => (p === null
  ? 'Aucune révision n’est prévue pour l’instant : elles apparaissent quand vous avez répondu à des exercices dont le contenu est vérifié.'
  : `Prochaine révision : ${dateDuJour(p)}.`);

export function vueRevision(ctx) {
  const racine = h('div', { class: 'vue vue-revision' });
  const zone = h('div', { class: 'revision', 'aria-live': 'polite' });
  // Fiches Anki importées : leur révision a son écran ; l'encart n'apparaît que si des fiches existent.
  const encartAnki = h('aside', { class: 'carte revision-anki', id: 'revision-anki', hidden: true, 'aria-label': 'Fiches Anki' });
  racine.append(h('h1', { tabindex: '-1' }, 'Révisions'), encartAnki, zone);
  (async () => {
    try {
      const A = ankiDe(ctx); if (await A.vide()) return;
      const s = preparerSeanceAnki((await A.corpus()).items, ctx.maintenant());
      encartAnki.replaceChildren(h('p', {}, s.total ? `Fiches Anki : ${s.dues.length} à revoir aujourd’hui${s.nouvelles.length ? `, ${s.nouvelles.length} nouvelle${s.nouvelles.length > 1 ? 's' : ''}` : ''}.` : 'Fiches Anki : rien à revoir aujourd’hui.'), h('p', {}, lien(hashPour('anki'), 'Réviser mes fiches Anki', s.total ? 'btn btn-secondaire' : 'lnk')));
      encartAnki.hidden = false;
    } catch { /* encart facultatif */ }
  })();
  let serie = 0, actif = true;
  const afficher = (...n) => zone.replaceChildren(...n);

  const perso = () => lirePref(ctx.journal, 'etude.personnel', false) === true;
  // Écriture des kana (facette S-ECR) : les items d'écriture rejoignent la banque dès que le journal contient une réponse d'écriture ; leurs données ne sont chargées qu'alors.
  let ecriture = [];
  const aDesReponsesEcriture = () => Object.keys(ctx.journal.view.learn ?? {}).some((k) => k.startsWith('kf:niv0:') && k.endsWith('#S-ECR'));
  const banque = () => (ctx.itemsRevision ? ctx.itemsRevision() : [...(perso() ? ctx.cat.lecons().filter((x) => NIVEAUX_OUVERTS.includes(x.niveau)).flatMap((x) => poolComplet(x)).map(rattacherPerso) : []), ...ecriture]);
  function calculer() {
    try { return preparerRevision({ derived: ctx.journal.derived, banque: banque(), personnel: perso(), maintenant: ctx.maintenant() }); } catch (e) { return { etat: 'erreur', erreur: e }; }
  }
  function rendre() {
    zone.removeAttribute('aria-busy');
    const r = calculer();
    if (r.etat === 'erreur') {
      afficher(note({ type: 'erreur', texte: 'Les révisions n’ont pas pu être calculées. Vos réponses sont intactes : réessayez.' }),
        h('p', { class: 'aide-courte', id: 'revision-detail' }, `Détail technique : ${r.erreur?.message ?? 'inconnu'}`),
        h('p', {}, bouton('Réessayer', 'btn-principal', async () => demarrerCalcul())));
      return;
    }
    if (r.etat === 'vide') {
      afficher(h('h2', {}, MESSAGE_VIDE), h('p', {}, phraseEcheance(r.prochaine)),
        h('p', { class: 'aide-courte' }, 'Une révision porte sur un élément déjà travaillé, au moment où il est utile de le revoir. Rien n’est imposé et rien ne s’accumule contre vous.'),
        h('p', {}, lien(hashPour('parcours'), 'Retour au parcours', 'btn btn-secondaire')));
      return;
    }
    if (r.etat === 'indisponible') {
      afficher(note({ type: 'info', texte: 'Des éléments sont à revoir, mais aucun contenu de révision n’est disponible : un exercice n’est proposé que si son niveau est vérifié par deux repères indépendants.' }),
        perso() ? null : h('p', {}, 'Vous pouvez activer l’étude personnelle dans ', lien('#/reglages', 'les réglages'), '.'),
        h('p', { class: 'aide-courte' }, `${r.sansContenu} élément${r.sansContenu > 1 ? 's' : ''} sans contenu admissible. Ils restent à revoir, sans retard compté.`),
        h('p', {}, lien(hashPour('parcours'), 'Retour au parcours', 'btn btn-secondaire')));
      return;
    }
    const bloque = !ctx.journal.canStartActivity();
    const relire = [...new Set(r.file.filter((f) => f.reprise && f.item.lecon).map((f) => f.item.lecon))].sort((a, b) => a - b);
    afficher(h('h2', {}, `Révisions, environ ${r.minutes} min`),
      h('p', {}, `${r.file.length} élément${r.file.length > 1 ? 's' : ''} à revoir aujourd’hui${r.reprises ? `, dont ${r.reprises} manqué${r.reprises > 1 ? 's' : ''} au premier essai, à reprendre` : ''}${r.reportees ? `, le reste est reporté sur les jours suivants` : ''}.`),
      relire.length ? h('p', { class: 'aide-courte' }, 'Avant de reprendre les éléments manqués, vous pouvez relire : ', ...relire.flatMap((n, k) => [k ? ', ' : '', lien(hashPour('lecon', n), `leçon ${n}`)]), '.') : null,
      bloque ? note({ type: 'avertissement', texte: 'Des actions précédentes ne sont pas encore enregistrées. Exportez-les ou réessayez depuis le bandeau avant de commencer.' }) : null,
      h('div', { class: 'barre-actions' }, bouton('Commencer la séance', 'btn-principal', async () => {
        if (!ctx.journal.canStartActivity()) { ctx.echec(Object.assign(new Error('actions en attente'), { code: 'blocked' })); return; }
        lancer(r);
      })));
  }
  function lancer(r) {
    const graine = `${graineSession()}|rev${serie++}`;
    jouerSerie(ctx, zone, r.file.map((f) => melangerItem(f.item, graine)), {
      prefixe: 'rev', arreter: true,
      resume: (res, partiel, aff) => {
        const suite = calculer();
        const t = h('h2', { tabindex: '-1', class: 'ex-titre' }, partiel ? 'Séance arrêtée' : 'Séance terminée');
        aff([t,
          h('p', { class: 'ex-score' }, res.total ? `Révisé${res.total > 1 ? 's' : ''} : ${res.total} élément${res.total > 1 ? 's' : ''}, ${res.justes} bien rappelé${res.justes > 1 ? 's' : ''}.` : 'Aucun élément révisé.'),
          partiel ? h('p', { class: 'aide-courte' }, 'Le reste est conservé et réparti sur les jours suivants, sans perte.') : null,
          h('p', {}, suite.etat === 'vide' || suite.etat === 'indisponible' ? phraseEcheance(suite.prochaine) : `Il reste ${suite.file.length} élément${suite.file.length > 1 ? 's' : ''} à revoir, à votre rythme.`),
          h('div', { class: 'barre-actions' }, lien(hashPour('accueil'), 'Retour à l’accueil', 'btn btn-principal'), suite.etat === 'a-reviser' ? bouton('Continuer', 'btn-secondaire', async () => rendre()) : null)]);
        t.focus();
      },
    });
  }
  function demarrerCalcul() {
    zone.setAttribute('aria-busy', 'true');
    afficher(h('div', { class: 'vue-chargement' }, h('p', { role: 'status', class: 'chargement' }, h('span', { class: 'chargement-trait', 'aria-hidden': 'true' }), 'Calcul des révisions…')));
    const charge = !ctx.itemsRevision && aDesReponsesEcriture() ? chargerDonneesEcriture().then((d) => { ecriture = d.items; }, () => { ecriture = []; }) : Promise.resolve();
    charge.then(() => { if (actif) setTimeout(rendre, 0); });
  }
  demarrerCalcul();
  return { titre: 'Révisions', element: racine, maj: () => {}, fin: () => { actif = false; } };
}
