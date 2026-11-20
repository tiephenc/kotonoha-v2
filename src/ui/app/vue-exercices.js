// KOTONOHA 2.0 · séries d'exercices (PX-03, PX-04 ; ET-08, ET-12). `sectionExercices` : section « Exercices » d'une leçon ; tout passe
// par `preparer` (core/exercices.js), donc par `selectionner` en mode entraînement : la règle des 10 % n'est jamais contournée.
// `jouerSerie` : déroulement d'une série (question, enregistrement AVANT le retour visuel, retour expliqué), partagé avec la révision.
// Deux interactions : choix d'une option (quiz, lecture, écoute) et phrase à remettre dans l'ordre (SORT de la V1).
import { h, melange } from './dom.js';
import { bouton, note, ligne, lien } from './composants-app.js';
import { lirePref, ETUDE_PERSO_DEFAUT } from '../../app/etude.js';
import { preparer, creerSession, MESSAGE_INDISPONIBLE, ETIQUETTE_PERSONNEL } from '../../core/exercices.js';
import { enregistrerReponse } from '../../app/reponses.js';
import { melangerItem } from '../../core/melange.js';
import { graineSession } from './graine.js';
import { reponseTrace } from './zone-trace.js';

const LIBELLE_STATUT = { 'estime-v1': 'niveau estimé', 'estime-un-repere': 'niveau estimé, une seule référence', 'estime-editorial-nouveau': 'niveau estimé, choix éditorial', verifie: 'niveau vérifié', 'hors-niveau': 'hors échelle JLPT, sans niveau attribué' };

/** Zone de réponse d'une question à options : `lire()` rend l'index choisi (ou null), `figer()` bloque, `bonne(r)` décrit la bonne réponse. */
function reponseOptions(q, n, groupe) {
  const radios = q.options.map((o, k) => {
    const input = h('input', { type: 'radio', class: 'chk-input', name: n, value: String(k), id: `${n}-o${k}` });
    groupe.append(h('label', { class: 'chk chk-radio', for: `${n}-o${k}` }, input, h('span', { class: 'chk-boite', 'aria-hidden': 'true' }), h('span', {}, melange(o))));
    return input;
  });
  return {
    focus: () => radios[0].focus(),
    lire: () => { const c = radios.find((r) => r.checked); return c ? Number(c.value) : null; },
    manque: 'Choisissez d’abord une réponse.',
    figer: () => radios.forEach((x) => { x.disabled = true; }),
    bonne: (r) => melange(q.options[r.bonne]),
  };
}

/** Zone de réponse d'une phrase à ordonner : les éléments (mélangés) se posent dans l'ordre, un par un ; on peut retirer le dernier. */
function reponseOrdre(q, n, groupe) {
  const affiche = q.ordre.map((k) => q.segments[k]), pris = [];
  const phrase = h('p', { class: 'phrase-construite', id: `${n}-phrase`, 'aria-live': 'polite' });
  const boutons = affiche.map((seg, p) => h('button', { type: 'button', class: 'btn btn-secondaire segment', id: `${n}-s${p}`, on: { click: () => { pris.push(p); maj(); } } }, melange(seg)));
  const retirer = h('button', { type: 'button', class: 'btn btn-secondaire', on: { click: () => { pris.pop(); maj(); } } }, 'Retirer le dernier élément');
  const effacer = h('button', { type: 'button', class: 'btn btn-secondaire', on: { click: () => { pris.length = 0; maj(); } } }, 'Tout effacer');
  function maj() {
    boutons.forEach((b, p) => { b.disabled = pris.includes(p); });
    retirer.disabled = effacer.disabled = pris.length === 0;
    phrase.replaceChildren(h('span', { class: 'aide-courte' }, `Votre phrase (${pris.length} sur ${affiche.length}) : `), ...pris.map((p) => h('span', { class: 'segment-pris' }, melange(affiche[p]))));
  }
  groupe.append(h('div', { class: 'segments' }, ...boutons), phrase, h('div', { class: 'barre-actions' }, retirer, effacer));
  maj();
  return {
    focus: () => boutons[0].focus(),
    lire: () => (pris.length === affiche.length ? [...pris] : null),
    manque: 'Placez d’abord tous les éléments de la phrase.',
    figer: () => { boutons.forEach((b) => { b.disabled = true; }); retirer.disabled = effacer.disabled = true; },
    bonne: (r) => melange(r.bonne.join('')),
  };
}

/**
 * Déroule une série dans `zone`. Chaque réponse est écrite au journal avant d'être corrigée à l'écran ; si l'écriture échoue,
 * le retour est retenu (le tampon garde la réponse) et « Réessayer l'enregistrement » est proposé.
 * @param {any} ctx @param {HTMLElement} zone @param {any[]} items items déjà mélangés (`melangerItem`)
 * @param {{prefixe: string, arreter?: boolean, resume: (r: any, partiel: boolean, aff: (e: any) => void) => void}} o
 */
export function jouerSerie(ctx, zone, items, { prefixe, arreter = false, resume, apres = null }) {
  const aff = (el) => zone.replaceChildren(...[].concat(el).filter(Boolean));
  const s = creerSession(items);
  const fin = (partiel) => resume(partiel ? s.resumePartiel() : s.resume(), partiel, aff);
  const question = () => {
    const q = s.courant, n = `${prefixe}-${s.index}`, debut = performance.now();
    const retour = h('div', { id: `${n}-retour`, role: 'status', class: 'note-zone' });
    const groupe = h('fieldset', { class: 'chk-groupe', id: n }, h('legend', { id: `${n}-q`, class: 'question' }, melange(q.question)));
    const rep = q.type === 'ordonner' ? reponseOrdre(q, n, groupe) : q.type === 'trace' ? reponseTrace(q, n, groupe) : reponseOptions(q, n, groupe);
    const entete = h('p', { class: 'ex-position', id: `${n}-pos` }, `Question ${s.index + 1} sur ${s.total}`);
    let choix = null;
    const montrer = () => {
      const r = s.repondre(choix);
      rep.figer();
      if (rep.retour) ligne(groupe, { type: r.juste ? 'succes' : 'erreur', texte: rep.retour(r) });
      else ligne(groupe, { type: r.juste ? 'succes' : 'erreur', texte: r.juste ? 'Bonne réponse.' : h('span', {}, 'Ce n’est pas la bonne réponse. Il fallait : ', rep.bonne(r), '.') });
      if (apres) { apres(q, r.juste, s.index); suivante.textContent = s.index + 1 < s.total ? 'Question suivante' : 'Voir le résumé'; }
      if (r.explication) retour.append(h('p', { class: 'ex-explication' }, h('strong', {}, 'Explication : '), melange(r.explication)));
      verifier.hidden = true; reessayer.hidden = true; suivante.hidden = false; suivante.focus();
    };
    const reessayer = bouton('Réessayer l’enregistrement', 'btn-secondaire', async () => {
      const ok = await ctx.journal.retry();
      if (ok || ctx.journal.canStartActivity()) { ligne(groupe, { type: 'succes', texte: 'Réponse enregistrée.' }); montrer(); } else ctx.signaler('L’enregistrement a encore échoué. Exportez les actions en attente depuis le bandeau, puis continuez.');
    });
    reessayer.hidden = true;
    const verifier = bouton('Vérifier', 'btn-principal', async () => {
      const c = rep.lire();
      if (c === null) { ligne(groupe, { type: 'avertissement', texte: rep.manque }); return; }
      if (choix === null) choix = c;
      let res;
      try { res = await enregistrerReponse(ctx.journal, q, { ok: s.evaluer(choix), ms: Math.round(performance.now() - debut), aid: rep.aide?.() ? 'decisive' : undefined }); } catch (e) { choix = null; ctx.echec(e); return; }
      if (!res.saved) {
        rep.figer();
        ligne(groupe, { type: 'avertissement', texte: 'Votre réponse n’est pas encore enregistrée sur cet appareil. Elle est gardée en attente : réessayez ou exportez-la avant de continuer.' });
        verifier.hidden = true; reessayer.hidden = false; reessayer.focus();
        return;
      }
      montrer();
    });
    const suivante = bouton(s.index + 1 < s.total ? 'Question suivante' : 'Voir le résumé', 'btn-principal', async () => { s.suivante(); s.fini ? fin(false) : question(); });
    suivante.hidden = true;
    rep.valider = () => verifier.click();
    const stop = arreter ? bouton('Arrêter ici', 'btn-secondaire', async () => { if (s.repondue) s.suivante(); fin(true); }) : null;
    const origine = q.perso ? h('p', { class: 'aide-courte' }, h('span', { class: 'etiquette', dataset: { perso: '1' } }, ETIQUETTE_PERSONNEL)) : q.statut === 'verifie' ? null : h('p', { class: 'aide-courte' }, `Contenu d’entraînement, ${LIBELLE_STATUT[q.statut] ?? q.statut}.`);
    aff([entete, groupe, origine, retour, h('div', { class: 'barre-actions' }, verifier, reessayer, suivante, stop)]);
    rep.focus();
  };
  question();
}

export function sectionExercices(ctx, lecon, pool) {
  const zone = h('div', { class: 'exercices' });
  const personnel = lirePref(ctx.journal, 'etude.personnel', ETUDE_PERSO_DEFAUT) === true;
  const prep = preparer(pool, { graine: lecon.numero, personnel });
  if (!prep.disponible) {
    zone.append(note({ type: 'info', texte: MESSAGE_INDISPONIBLE }),
      personnel ? null : h('p', {}, 'Vous pouvez activer l’étude personnelle dans ', lien('#/reglages', 'les réglages'), '.'),
      h('p', { class: 'aide-courte' }, `Motif : ${prep.motif ?? 'aucun item admissible.'}`),
      h('p', { class: 'aide-courte' }, 'Ces contenus restent lisibles dans les autres sections de la leçon.'));
    return { element: zone, indisponible: true };
  }
  let serie = 0;
  const demarrer = () => {
    // Options et segments mélangés par la graine de session et le numéro de série : jamais la clé toujours au même rang.
    const graine = `${graineSession()}|${serie++}`;
    jouerSerie(ctx, zone, prep.items.map((it) => melangerItem(it, graine)), {
      prefixe: `ex-${lecon.numero}`,
      resume: (r, _partiel, aff) => {
        const t = h('h4', { tabindex: '-1', class: 'ex-titre' }, 'Résumé de la série');
        aff([t, h('p', { class: 'ex-score' }, `Vous avez répondu juste à ${r.justes} question${r.justes > 1 ? 's' : ''} sur ${r.total}.`),
          h('ul', {}, ...r.detail.map((d, k) => h('li', {}, `Question ${k + 1} : ${d.juste ? 'juste' : 'à revoir'}`))),
          h('div', { class: 'barre-actions' }, bouton('Refaire une série', 'btn-secondaire', async () => demarrer()))]);
        t.focus();
      },
    });
  };
  zone.append(h('p', {}, `Une série de ${prep.items.length} questions, sans note. Chaque réponse est expliquée.${personnel ? ' Étude personnelle : niveau estimé, non certifié.' : ''}`),
    h('div', { class: 'barre-actions' }, bouton('Commencer la série', 'btn-principal', async () => demarrer())));
  return { element: zone, indisponible: false };
}
