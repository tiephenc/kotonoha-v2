// KOTONOHA 2.0 · vue « Écrire les kana » (`#/kana/ecrire`, `#/kana/ecrire/<groupe>`). Un kana à la fois : on trace, la correction (core/kana-trace.js)
// dit ce qui ne va pas, le modèle KanjiVG se superpose. Chaque tentative est UNE réponse du journal sur la facette S-ECR du signe (mêmes opérations
// que les autres exercices, via `jouerSerie`) : le moteur de consolidation la planifie, la vue Révisions peut la proposer. Un kana raté revient
// plus tôt dans la même séance (file de reprise, core/niv0-ecriture.js). Sans connexion : tout est local.
import { h, ja } from './dom.js';
import { barre, bouton, lien, note } from './composants-app.js';
import { jouerSerie } from './vue-exercices.js';
import { graineSession } from './graine.js';
import { hashPour, hashEcriture } from './routeur.js';
import { chargerDonneesEcriture } from './donnees-ecriture.js';
import { svgModele } from './zone-trace.js';
import { avancementEcriture, ordreSeance, reinserer } from '../../core/niv0-ecriture.js';
import { consolidate } from '../../core/consolidation.js';
import { jourLocal } from '../../core/revision.js';
import { LIBELLE_HORS_NIVEAU } from '../../core/niv0-lecon.js';

const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const etiquette = () => h('p', {}, h('span', { class: 'etiquette', id: 'kana-hors-niveau' }, LIBELLE_HORS_NIVEAU));
const credit = () => h('p', { class: 'aide-courte', id: 'kana-traces-licence' }, 'Tracés des signes : projet KanjiVG, Ulrich Apel, licence CC BY-SA 3.0 (',
  h('a', { class: 'lnk', href: 'https://kanjivg.tagaini.net/', rel: 'noopener noreferrer' }, 'kanjivg.tagaini.net'), '). Les seuils de correction sont provisoires [Hyp].');

export function vueKanaEcriture(ctx, r) {
  const racine = h('div', { class: 'vue vue-kana vue-kana-ecriture' });
  const titre = h('h1', { tabindex: '-1' }, 'Écrire les kana');
  const corps = h('div', { class: 'kana-corps' });
  racine.append(titre, corps);
  const v = { titre: 'Écrire les kana', element: racine, maj: () => {}, fin: () => { vivant = false; } };
  let vivant = true, d = null;
  const poserTitre = (t) => { v.titre = t; if (vivant) document.title = `${t} · KOTONOHA`; };
  const vue = () => ctx.journal.view;
  const facettes = () => { try { return consolidate(ctx.journal.derived, { dayOf: jourLocal }).facets; } catch { return {}; } };

  /** Où reprendre : le premier groupe, dans l'ordre du parcours, dont tous les signes n'ont pas encore été réussis. */
  function reprise(av) {
    const i = av.findIndex((a) => a.reussis < a.total);
    if (i < 0) return h('p', { class: 'aide-courte', id: 'ecr-reprise' }, 'Tous les signes ont été écrits avec succès au moins une fois : ils reviendront dans les révisions.');
    const g = d.groupes[i], a = av[i];
    return h('p', { id: 'ecr-reprise' }, lien(hashEcriture(g.id), `${a.essayes ? 'Reprendre' : 'Commencer'} l’écriture : groupe ${g.numero}, ${g.signes.map((x) => x.caractere).join(' ')}`, 'btn btn-principal'));
  }

  // ——— Liste des groupes ———
  function liste() {
    titre.textContent = 'Écrire les kana';
    poserTitre('Écrire les kana');
    const rendre = () => {
      const av = d.groupes.map((g) => avancementEcriture(g, vue()));
      const total = d.groupes.reduce((n, g) => n + g.signes.length, 0), reussis = av.reduce((n, a) => n + a.reussis, 0);
      const parEtape = new Map();
      d.groupes.forEach((g, i) => { if (!parEtape.has(g.etape)) parEtape.set(g.etape, []); parEtape.get(g.etape).push([g, av[i]]); });
      const numEtape = new Map([...parEtape.keys()].map((e, k) => [e, k + 1]));
      corps.replaceChildren(
        etiquette(),
        h('p', { class: 'chapeau' }, 'Tracez chaque signe au doigt, à la souris ou au stylet : la correction vérifie le nombre de traits, leur ordre, leur sens et leur position. Un signe raté revient plus tôt dans la séance, puis dans les révisions.'),
        h('p', { class: 'aide-courte', id: 'ecr-ordre' }, 'Ordre conseillé : signes de base, dakuten et handakuten, puis yōon (petit ゃ ゅ ょ, puis les combinaisons à deux caractères), petit っ et, en katakana, la barre ー. Les katakana suivent les hiragana.'),
        reprise(av),
        h('section', { class: 'carte', 'aria-labelledby': 'ecr-prog-titre' }, h('h2', { id: 'ecr-prog-titre' }, 'Votre progression'), barre('ecr-prog', 'Signes écrits avec succès', reussis, total, 'Signes réussis').element),
        ...[...parEtape].map(([etape, gs]) => {
          const id = `ecr-et-${etape}`;
          return h('section', { class: 'module', 'aria-labelledby': id },
            h('h2', { id }, `${majuscule(gs[0][0].ecriture)} · ${gs[0][0].titreEtape}`),
            h('p', { class: 'aide-courte ecr-etape' }, `Étape ${numEtape.get(etape)} sur ${parEtape.size} : ${gs.reduce((n, [, a]) => n + a.reussis, 0)} signe${gs.reduce((n, [, a]) => n + a.reussis, 0) > 1 ? 's' : ''} réussi${gs.reduce((n, [, a]) => n + a.reussis, 0) > 1 ? 's' : ''} sur ${gs.reduce((n, [, a]) => n + a.total, 0)}.`),
            h('ol', { class: 'prog-segments lecons' }, ...gs.map(([g, a]) => h('li', { class: 'lecon-ligne', dataset: { etat: a.reussis === a.total ? 'terminee' : a.essayes ? 'en-cours' : 'non-commencee' } },
              h('span', { class: 'prog-pastille', 'aria-hidden': 'true' }),
              h('a', { class: 'lnk', href: hashEcriture(g.id) }, h('span', { class: 'nom-lecon' }, `Groupe ${g.numero} : `, ja(g.signes.map((s) => s.caractere).join(' '))), h('span', { class: 'kds-masque' }, ` : ${a.reussis} sur ${a.total} réussi${a.reussis > 1 ? 's' : ''}`)),
              h('span', { class: 'prog-etat', 'aria-hidden': 'true' }, `${a.reussis}/${a.total}`)))));
        }),
        h('p', {}, lien(hashPour('kana'), 'Retour aux leçons de kana', 'btn btn-secondaire')),
        credit());
    };
    rendre();
    v.maj = rendre;
  }

  /** Rappels propres aux petits signes (ゃ, っ…) et aux yōon : taille, place, signes à connaître d'abord. */
  function notesDisposition(g) {
    const yoon = g.signes.some((s) => s.type === 'yoon'), petit = g.signes.some((s) => s.type === 'petit');
    const notes = [];
    if (petit) notes.push(note({ type: 'info', texte: 'Un petit kana s’écrit nettement plus petit qu’un signe normal, dans le coin en bas à gauche de sa case (le cadre pointillé le rappelle). Il est jugé sur sa forme, sa taille et sa place.' }));
    if (yoon) {
      const petits = d.groupes.find((x) => x.ecriture === g.ecriture && x.signes.some((s) => s.cle === 'xya'));
      notes.push(note({ type: 'info', texte: 'Un yōon s’écrit en deux caractères : le premier en taille normale, le second (ゃ, ゅ ou ょ) petit, sur la même ligne du bas, juste à sa droite. Le tracé est jugé sur la forme de chaque caractère, puis sur la taille et la place du petit : trop grand, trop haut ou trop loin est signalé.' }));
      if (petits && petits !== g) notes.push(h('p', { class: 'aide-courte', id: 'ecr-prerequis' }, 'Avant ce groupe : le petit signe et le premier caractère. ', lien(hashEcriture(petits.id), `Revoir le groupe ${petits.numero} (petits ゃ ゅ ょ)`, 'lnk')));
    }
    const a = (cars) => g.signes.some((x) => [...cars].includes(x.caractere));
    if (a('っッ')) notes.push(note({ type: 'info', texte: 'Le petit っ (ッ en katakana) double la consonne qui suit : きって se lit « kitté ». Il s’écrit comme つ (ツ), mais petit, en bas à gauche de sa case.' }));
    if (a('ー')) notes.push(note({ type: 'info', texte: 'La barre ー allonge la voyelle précédente (コーヒー). En écriture horizontale c’est un trait horizontal, tracé de gauche à droite ; la barre verticale de l’écriture en colonnes n’est pas traitée ici.' }));
    if (a('へヘ')) notes.push(note({ type: 'info', texte: 'へ (hiragana) et ヘ (katakana) ont presque la même forme : la correction ne peut pas les distinguer, c’est la consigne qui dit lequel écrire. Le hiragana est un peu plus arrondi, le katakana plus anguleux.' }));
    if (a('ぢづヂヅ')) notes.push(note({ type: 'info', texte: 'ぢ et づ se lisent comme じ et ず ; on les rencontre surtout dans quelques mots (はなぢ, つづく). Leurs traits les distinguent de じ et de ず.' }));
    return notes;
  }

  // ——— Un groupe ———
  function groupe(g) {
    const chars = g.signes.map((s) => s.caractere).join(' ');
    titre.replaceChildren(`Écrire : groupe ${g.numero}, `, ja(chars));
    poserTitre(`Écrire le groupe ${g.numero} de kana`);
    const ids = new Set(g.signes.map((s) => s.id));
    const items = d.items.filter((it) => ids.has(it.entreeId));
    const i = d.groupes.indexOf(g), suivant = d.groupes[i + 1], precedent = d.groupes[i - 1];
    const zone = h('div', { class: 'exercices', id: 'ecr-exercices' });
    let serie = 0;

    const demarrer = () => {
      const file = ordreSeance(items, { facets: facettes(), learn: vue().learn, graine: `${graineSession()}|${g.id}|${serie++}` });
      let reprises = {};
      jouerSerie(ctx, zone, file, {
        prefixe: `ecr-${g.id}`, arreter: true,
        apres: (q, juste, index) => {
          if (juste) return;
          const reste = file.slice(index + 1);
          const res = reinserer(reste, q, reprises);
          if (res.reinsere) { file.splice(index + 1, reste.length, ...res.file); reprises = res.reprises; }
        },
        resume: (res, partiel, aff) => {
          const t = h('h3', { tabindex: '-1', class: 'ex-titre', id: 'kana-bilan' }, partiel ? 'Séance arrêtée' : 'Bilan de la séance d’écriture');
          const parSigne = new Map();
          res.detail.forEach((x) => { const e = parSigne.get(x.id) ?? { n: 0, juste: false }; e.n++; e.juste = x.juste; parSigne.set(x.id, e); });
          const nomDe = new Map(items.map((it) => [it.id, it]));
          const nbRates = [...parSigne.values()].filter((e) => !e.juste).length;
          aff([t,
            h('p', { class: 'ex-score', id: 'kana-score' }, `${res.justes} tracé${res.justes > 1 ? 's' : ''} reconnu${res.justes > 1 ? 's' : ''} sur ${res.total} tentative${res.total > 1 ? 's' : ''}.`),
            h('ul', { id: 'ecr-bilan' }, ...[...parSigne].map(([id, e]) => h('li', {}, ja(nomDe.get(id)?.caractere ?? ''), ` : ${e.juste ? 'réussi' : 'à revoir'}${e.n > 1 ? ` (${e.n} essais)` : ''}`))),
            nbRates ? h('p', { class: 'aide-courte' }, 'Les signes à revoir reviendront dans la prochaine séance et dans les révisions.') : null,
            h('div', { class: 'barre-actions' }, bouton('Refaire une série', 'btn-secondaire', async () => demarrer()), lien(hashEcriture(), 'Retour à la liste des groupes', 'btn btn-secondaire'),
              !nbRates && !partiel && suivant ? lien(hashEcriture(suivant.id), `Groupe suivant (${suivant.numero})`, 'btn btn-principal') : null)]);
          t.focus();
        },
      });
    };

    const apercus = g.signes.map((e) => {
      const it = items.find((x) => x.entreeId === e.id), trace = { traits: it.traits }, disposition = it.disposition ?? null;
      const li = h('li', { class: 'ecr-signe' });
      const dessiner = (anime) => { li.querySelector('svg')?.remove(); li.prepend(svgModele(trace.traits, { anime, disposition, titre: `Ordre des ${trace.traits.length} traits de ${e.caractere}${disposition ? (disposition.parties.length > 1 ? ', en deux caractères' : ', petit signe en bas à gauche') : ''}` })); };
      li.append(h('div', { class: 'kana-infos' },
        h('span', { class: 'kana-car', lang: 'ja' }, e.caractere),
        h('span', {}, e.romanisation ? `Lecture : « ${e.romanisation} »` : 'Signe auxiliaire'),
        h('span', {}, `${trace.traits.length} trait${trace.traits.length > 1 ? 's' : ''}`),
        bouton('Revoir l’ordre des traits', 'btn-secondaire', async () => dessiner(true))));
      dessiner(false);
      return li;
    });

    zone.append(h('div', {}, h('p', {}, 'Le signe est demandé par sa lecture : tracez-le de mémoire. Le bouton « Montrer le modèle » est une aide : la réponse est alors enregistrée comme aidée et ne compte pas comme un rappel réussi. Chaque tentative est enregistrée avant la correction.'),
      h('div', { class: 'barre-actions' }, bouton('Commencer la série d’écriture', 'btn-principal', async () => demarrer()))));

    corps.replaceChildren(etiquette(),
      h('p', { class: 'aide-courte' }, `${majuscule(g.ecriture)} · ${g.titreEtape}`),
      h('section', { class: 'carte', 'aria-labelledby': 'ecr-signes-titre' }, h('h2', { id: 'ecr-signes-titre' }, 'Les signes et l’ordre des traits'),
        h('ul', { class: 'kana-signes ecr-signes' }, ...apercus),
        note({ type: 'info', texte: 'Les traits sont numérotés dans l’ordre d’écriture, au point de départ. Un tracé n’est jugé que sur la forme : l’épaisseur, les crochets et les finitions ne sont pas évalués.' }),
        ...notesDisposition(g)),
      h('section', { class: 'carte', 'aria-labelledby': 'ecr-ex-titre' }, h('h2', { id: 'ecr-ex-titre' }, 'Écriture'), zone),
      h('nav', { class: 'barre-actions', 'aria-label': 'Groupes d’écriture' }, lien(hashEcriture(), 'Liste des groupes', 'btn btn-secondaire'),
        precedent ? lien(hashEcriture(precedent.id), `Groupe précédent (${precedent.numero})`, 'btn btn-secondaire') : null,
        suivant ? lien(hashEcriture(suivant.id), `Groupe suivant (${suivant.numero})`, 'btn btn-secondaire') : null),
      credit());
  }

  const introuvable = () => { titre.textContent = 'Groupe introuvable'; poserTitre('Groupe introuvable'); corps.replaceChildren(h('p', {}, 'Ce groupe n’existe pas.'), h('p', {}, lien(hashEcriture(), 'Retour à la liste des groupes', 'btn btn-principal'))); };
  const charger = () => {
    corps.replaceChildren(h('p', { role: 'status', class: 'chargement' }, h('span', { class: 'chargement-trait', 'aria-hidden': 'true' }), 'Chargement des tracés…'));
    chargerDonneesEcriture().then((donnees) => {
      if (!vivant) return;
      d = donnees;
      if (!r.groupe) liste();
      else { const g = d.groupes.find((x) => x.id === r.groupe); g ? groupe(g) : introuvable(); }
    }, (e) => {
      if (!vivant) return;
      corps.replaceChildren(note({ type: 'erreur', texte: 'Les tracés des kana n’ont pas pu être chargés. Vérifiez votre connexion puis réessayez ; vos données personnelles ne sont pas touchées.' }),
        h('p', { class: 'aide-courte', id: 'erreur-detail' }, `Détail technique : ${e?.message ?? 'inconnu'}`),
        h('p', {}, bouton('Réessayer', 'btn-principal', async () => charger())));
    });
  };
  charger();
  return v;
}
