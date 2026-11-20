// KOTONOHA 2.0 · vue Kana (PH-6, L21-C) : liste des groupes du parcours, leçon d'un groupe (présentation, reconnaissance, bilan),
// section « Longueurs et petit っ ». Indépendante du catalogue V1 : elle charge `donnees/niv0/*.json` elle-même.
// Les réponses passent par `jouerSerie` (enregistrement au journal AVANT le retour visuel) ; « groupe terminé » = préférence `kana.<groupe>`.
import { h, ja } from './dom.js';
import { barre, bouton, lien, note } from './composants-app.js';
import { jouerSerie } from './vue-exercices.js';
import { reglerPref } from '../../app/etude.js';
import { graineSession } from './graine.js';
import { hashPour, hashEcriture } from './routeur.js';
import { vueKanaEcriture } from './vue-kana-ecriture.js';
import { groupesParcours, etatGroupe, groupeReussi, confondables, itemsDuGroupe, itemsLongueurs, sujetGroupe, ETATS_GROUPE, LIBELLE_HORS_NIVEAU, SEUIL_GROUPE } from '../../core/niv0-lecon.js';

const BASE = new URL('../../../donnees/niv0/', import.meta.url).href;
const TEXTE_ETAT = { [ETATS_GROUPE.nonCommence]: 'non commencé', [ETATS_GROUPE.enCours]: 'en cours', [ETATS_GROUPE.termine]: 'terminé' };
const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);

let promesse = null;
/** Charge kana.json et mots-longueurs.json (une fois ; un échec n'est pas mémorisé). */
export function chargerDonneesKana(f = globalThis.fetch) {
  promesse ??= (async () => {
    const lire = async (nom) => { const r = await f(new URL(nom, BASE)); if (!r.ok) throw new Error(`${nom} : HTTP ${r.status}`); return r.json(); };
    const [kana, mots] = await Promise.all([lire('kana.json'), lire('mots-longueurs.json')]);
    return { kana, mots, groupes: groupesParcours(kana) };
  })().catch((e) => { promesse = null; throw e; });
  return promesse;
}

const etiquette = () => h('p', {}, h('span', { class: 'etiquette', id: 'kana-hors-niveau' }, LIBELLE_HORS_NIVEAU));

/** Carte d'un signe : caractère, romanisation, lecture française, signes proches. */
function carteSigne(e, parId) {
  const lis = [];
  if (e.romanisation) lis.push(h('span', {}, 'Romanisation : ', h('strong', {}, e.romanisation)), h('span', {}, 'Lecture française : ', h('strong', {}, `« ${e.lectureFr} »`)));
  else lis.push(h('span', {}, 'Signe auxiliaire : il se lit avec le signe voisin, sans lecture isolée.'));
  if (e.transformeDe) lis.push(h('span', {}, 'Dérivé de ', ja(parId.get(e.transformeDe)?.caractere ?? ''), '.'));
  const proches = confondables(e);
  if (proches.length) lis.push(h('span', { class: 'kana-proches' }, 'À ne pas confondre avec : ', ...proches.flatMap((c, i) => [i ? ' ' : '', ja(c)]), '.'));
  return h('li', { class: 'kana-signe' }, h('span', { class: 'kana-car', lang: 'ja' }, e.caractere), h('div', { class: 'kana-infos' }, ...lis));
}

export function vueKana(ctx, r) {
  if (r.mode === 'ecrire') return vueKanaEcriture(ctx, r);
  const racine = h('div', { class: 'vue vue-kana' });
  const titre = h('h1', { tabindex: '-1' }, 'Kana');
  const corps = h('div', { class: 'kana-corps' });
  racine.append(titre, corps);
  const v = { titre: 'Kana', element: racine, maj: () => {}, fin: () => { vivant = false; } };
  let vivant = true, d = null;
  const poserTitre = (t) => { v.titre = t; if (vivant) document.title = `${t} · KOTONOHA`; };
  const vue = () => ctx.journal.view;

  // ——— Liste des groupes ———
  function liste() {
    titre.textContent = 'Kana';
    poserTitre('Kana');
    const rendre = () => {
      const etats = d.groupes.map((g) => etatGroupe(g, vue()));
      const faits = etats.filter((e) => e === ETATS_GROUPE.termine).length;
      const parEtape = new Map();
      d.groupes.forEach((g, i) => { if (!parEtape.has(g.etape)) parEtape.set(g.etape, []); parEtape.get(g.etape).push([g, etats[i]]); });
      corps.replaceChildren(
        etiquette(),
        h('p', { class: 'chapeau' }, 'Hiragana puis katakana, groupe par groupe : on découvre quelques signes, puis on s’exerce à les reconnaître. Un groupe est terminé à 90 % de réussite [Hyp : seuil provisoire].'),
        h('section', { class: 'carte', 'aria-labelledby': 'kana-prog-titre' }, h('h2', { id: 'kana-prog-titre' }, 'Votre progression'), barre('kana-prog', 'Groupes terminés', faits, d.groupes.length, 'Groupes terminés').element),
        ...[...parEtape].map(([etape, gs]) => {
          const id = `kana-et-${etape}`;
          return h('section', { class: 'module', 'aria-labelledby': id },
            h('h2', { id }, `${majuscule(gs[0][0].ecriture)} · ${gs[0][0].titreEtape}`),
            h('ol', { class: 'prog-segments lecons' }, ...gs.map(([g, e]) => h('li', { dataset: { etat: e }, class: 'lecon-ligne' },
              h('span', { class: 'prog-pastille', 'aria-hidden': 'true' }),
              h('a', { class: 'lnk', href: hashPour('kana', g.id) }, h('span', { class: 'nom-lecon' }, `Groupe ${g.numero} : `, ja(g.signes.map((s) => s.caractere).join(' '))), h('span', { class: 'kds-masque' }, ` : ${TEXTE_ETAT[e]}`)),
              h('span', { class: 'prog-etat', 'aria-hidden': 'true' }, TEXTE_ETAT[e])))));
        }),
        h('section', { class: 'module', 'aria-labelledby': 'kana-ecrire-titre' },
          h('h2', { id: 'kana-ecrire-titre' }, 'Écrire les kana'),
          h('p', {}, 'Tracer les signes au doigt, à la souris ou au stylet, avec correction trait par trait.'),
          h('p', {}, lien(hashEcriture(), 'Écrire les kana', 'btn btn-secondaire'))),
        h('section', { class: 'module', 'aria-labelledby': 'kana-longueurs-titre' },
          h('h2', { id: 'kana-longueurs-titre' }, 'Longueurs et petit ', ja('っ')),
          h('p', {}, 'Voyelles longues et consonnes tenues : des paires de mots qui ne diffèrent que par là.'),
          h('p', {}, lien(hashPour('kana', 'longueurs'), 'Exercices sur les longueurs', 'btn btn-secondaire'))));
    };
    rendre();
    v.maj = rendre;
  }

  // ——— Leçon d'un groupe ———
  function lecon(g) {
    const parId = new Map(d.kana.entrees.map((e) => [e.id, e]));
    const chars = g.signes.map((s) => s.caractere).join(' ');
    titre.replaceChildren(`Groupe ${g.numero} : `, ja(chars));
    poserTitre(`Groupe ${g.numero} de kana`);
    const i = d.groupes.indexOf(g), suivant = d.groupes[i + 1], precedent = d.groupes[i - 1];
    const zone = h('div', { class: 'exercices', id: 'kana-exercices' });
    let serie = 0;
    const marquer = async (texte) => {
      if (vue().prefs[sujetGroupe(g.id)]?.v === 'termine') return;
      try { const res = await reglerPref(ctx.journal, sujetGroupe(g.id), 'termine'); ctx.confirmer(res, texte); } catch (e) { ctx.echec(e); }
    };
    const demarrer = () => {
      const items = itemsDuGroupe(d.kana, g, `${graineSession()}|${serie++}`);
      jouerSerie(ctx, zone, items, {
        prefixe: `kana-${g.id}`,
        resume: async (res, _p, aff) => {
          const t = h('h3', { tabindex: '-1', class: 'ex-titre', id: 'kana-bilan' }, 'Bilan du groupe');
          const reussi = groupeReussi(res.justes, res.total);
          const pct = Math.round((100 * res.justes) / res.total);
          const seuil = Math.round(SEUIL_GROUPE * 100);
          aff([t, h('p', { class: 'ex-score', id: 'kana-score' }, `Vous avez répondu juste à ${res.justes} question${res.justes > 1 ? 's' : ''} sur ${res.total} (${pct} %).`),
            h('p', { id: 'kana-verdict', role: 'status' }, reussi ? `Groupe terminé : le seuil de ${seuil} % est atteint [Hyp : seuil provisoire].` : `Groupe pas encore terminé : il faut ${seuil} % de réussite [Hyp : seuil provisoire]. Refaites une série.`),
            h('ul', {}, ...res.detail.map((x, k) => h('li', {}, `Question ${k + 1} : ${x.juste ? 'juste' : 'à revoir'}`))),
            h('div', { class: 'barre-actions' }, bouton('Refaire une série', 'btn-secondaire', async () => demarrer()), lien(hashPour('kana'), 'Retour à la liste des groupes', 'btn btn-secondaire'),
              reussi && suivant ? lien(hashPour('kana', suivant.id), `Groupe suivant (${suivant.numero})`, 'btn btn-principal') : null)]);
          t.focus();
          if (reussi) await marquer('Groupe terminé, enregistré sur cet appareil.');
        },
      });
    };
    const aDesQuestions = itemsDuGroupe(d.kana, g, 'x').length > 0;
    zone.append(aDesQuestions
      ? h('div', {}, h('p', {}, 'Des questions dans les deux sens (signe vers lecture, lecture vers signe), uniquement avec des signes déjà vus. Chaque réponse est corrigée tout de suite, sans note.'),
        h('div', { class: 'barre-actions' }, bouton('Commencer la série', 'btn-principal', async () => demarrer())))
      : h('div', {}, h('p', {}, 'Ces signes se lisent avec le signe voisin : il n’y a pas de question de reconnaissance isolée pour ce groupe.'),
        h('div', { class: 'barre-actions' }, bouton('J’ai vu ces signes', 'btn-principal', async () => { await marquer('Groupe marqué comme vu.'); }))));
    corps.replaceChildren(etiquette(),
      h('p', { class: 'aide-courte' }, `${majuscule(g.ecriture)} · ${g.titreEtape}`),
      h('section', { class: 'carte', 'aria-labelledby': 'kana-signes-titre' }, h('h2', { id: 'kana-signes-titre' }, 'Les signes'),
        h('ul', { class: 'kana-signes' }, ...g.signes.map((e) => carteSigne(e, parId))),
        note({ type: 'info', texte: 'La lecture française est une approximation, qui ne remplace pas l’audio : aucun son n’est encore proposé ici.' }),
        h('p', {}, lien(hashEcriture(g.id), 'Écrire ces signes', 'btn btn-secondaire'), h('span', { class: 'aide-courte' }, ' Tracé au doigt, à la souris ou au stylet, avec correction : même groupe, dans « Écrire les kana ».'))),
      h('section', { class: 'carte', 'aria-labelledby': 'kana-ex-titre' }, h('h2', { id: 'kana-ex-titre' }, 'Exercices de reconnaissance'), zone),
      h('nav', { class: 'barre-actions', 'aria-label': 'Groupes' }, lien(hashPour('kana'), 'Liste des groupes', 'btn btn-secondaire'),
        precedent ? lien(hashPour('kana', precedent.id), `Groupe précédent (${precedent.numero})`, 'btn btn-secondaire') : null,
        suivant ? lien(hashPour('kana', suivant.id), `Groupe suivant (${suivant.numero})`, 'btn btn-secondaire') : null));
  }

  // ——— Longueurs et petit っ ———
  function longueurs() {
    titre.replaceChildren('Longueurs et petit ', ja('っ'));
    poserTitre('Longueurs et petit っ');
    const zone = h('div', { class: 'exercices', id: 'kana-exercices' });
    let serie = 0;
    const demarrer = () => {
      jouerSerie(ctx, zone, itemsLongueurs(d.mots, `${graineSession()}|${serie++}`), {
        prefixe: 'kana-longueurs',
        resume: (res, _p, aff) => {
          const t = h('h3', { tabindex: '-1', class: 'ex-titre', id: 'kana-bilan' }, 'Bilan de la série');
          aff([t, h('p', { class: 'ex-score', id: 'kana-score' }, `Vous avez répondu juste à ${res.justes} question${res.justes > 1 ? 's' : ''} sur ${res.total}.`),
            h('ul', {}, ...res.detail.map((x, k) => h('li', {}, `Question ${k + 1} : ${x.juste ? 'juste' : 'à revoir'}`))),
            h('div', { class: 'barre-actions' }, bouton('Refaire une série', 'btn-secondaire', async () => demarrer()), lien(hashPour('kana'), 'Retour à la liste des groupes', 'btn btn-secondaire'))]);
          t.focus();
        },
      });
    };
    zone.append(h('p', {}, `Une série de ${itemsLongueurs(d.mots, 'x').length} questions, sans note, sur des paires de mots proches.`), h('div', { class: 'barre-actions' }, bouton('Commencer la série', 'btn-principal', async () => demarrer())));
    corps.replaceChildren(etiquette(),
      note({ type: 'info', texte: 'ii s’écrit ii ; le macron note ー et les autres voyelles longues (ā, ū, ē, ō).' }),
      note({ type: 'info', texte: 'Ces paires de mots ont été relues par une relecture linguistique automatisée (AC-2, 19/11/2026), sans relecture humaine ni audio : la prononciation reste à écouter ailleurs.' }),
      h('section', { class: 'carte', 'aria-labelledby': 'kana-paires-titre' }, h('h2', { id: 'kana-paires-titre' }, 'Les paires'),
        h('ul', { class: 'kana-paires' }, ...d.mots.paires.map((p) => h('li', { class: 'kana-paire' }, h('p', { class: 'aide-courte' }, p.difference),
          h('ul', {}, ...p.mots.map((m) => h('li', {}, ja(m.kana), ` : ${m.romanisation}, ${m.sens}`))))))),
      h('section', { class: 'carte', 'aria-labelledby': 'kana-ex-titre' }, h('h2', { id: 'kana-ex-titre' }, 'Exercices de reconnaissance'), zone),
      h('p', {}, lien(hashPour('kana'), 'Retour à la liste des groupes', 'btn btn-secondaire')));
  }

  const introuvable = () => { titre.textContent = 'Groupe introuvable'; poserTitre('Groupe introuvable'); corps.replaceChildren(h('p', {}, 'Ce groupe n’existe pas.'), h('p', {}, lien(hashPour('kana'), 'Retour à la liste des groupes', 'btn btn-principal'))); };
  const charger = () => {
    corps.replaceChildren(h('p', { role: 'status', class: 'chargement' }, h('span', { class: 'chargement-trait', 'aria-hidden': 'true' }), 'Chargement des kana…'));
    chargerDonneesKana().then((donnees) => {
      if (!vivant) return;
      d = donnees;
      if (!r.groupe) liste();
      else if (r.groupe === 'longueurs') longueurs();
      else { const g = d.groupes.find((x) => x.id === r.groupe); g ? lecon(g) : introuvable(); }
    }, (e) => {
      if (!vivant) return;
      corps.replaceChildren(note({ type: 'erreur', texte: 'Les données des kana n’ont pas pu être chargées. Vérifiez votre connexion puis réessayez ; vos données personnelles ne sont pas touchées.' }),
        h('p', { class: 'aide-courte', id: 'erreur-detail' }, `Détail technique : ${e?.message ?? 'inconnu'}`),
        h('p', {}, bouton('Réessayer', 'btn-principal', async () => charger())));
    });
  };
  charger();
  return v;
}
