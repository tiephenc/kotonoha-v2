// KOTONOHA 2.0 · écran Leçon (PX-03 ; ET-03, ET-04, ET-06). Sections dans l'ordre V1 (`ordreChamps`), furigana construits par
// nœuds (jamais `innerHTML` sur une donnée), validation et niveau de chaque contenu affichés (Q-12).
import { h, ja, jaFurigana, melange, brut } from './dom.js';
import { barre, caseACocher, interrupteur, bouton, note, lien } from './composants-app.js';
import { sectionsDeLecon, sectionEtudiee, leconMarquee, etatLecon, SECTIONS } from '../../core/parcours.js';
import { marquerEtude, reglerPref, lirePref } from '../../app/etude.js';
import { label } from '../../core/statut-niveau.js';
import { sansFurigana } from '../../core/catalogue.js';
import { poolComplet, poolSpecial } from '../../core/exercices.js';
import { selectionnerExamen } from '../../core/selection-evaluation.js';
import { COMPETENCES } from '../../core/positionnement.js';
import { sectionExercices } from './vue-exercices.js';
import { voixJaponaise, surVoix, lire } from './voix.js';
import { hashPour, NIVEAUX_OUVERTS } from './routeur.js';

const NB = ' ';
/** Un outil ne conclut pas à la conformité d'un contenu : il signale ce qu'il détecte. */
const RESULTAT_AC0 = { conforme: 'aucun défaut détecté', incertain: 'signalement à examiner', erreur: 'défaut bloquant' };

/** Étiquette de validation d'un contenu (jamais « validé par un humain »). */
function etiquetteBrute(v) {
  if (typeof v === 'string') return h('span', { class: 'validation', dataset: { validation: 'aucune' } }, v);
  if (v.valeur === 'controle-automatique') return h('span', { class: 'validation', dataset: { validation: 'automatique' } }, `contrôle automatique AC-0${NB}: ${RESULTAT_AC0[v.resultat]}`);
  return h('span', { class: 'validation', dataset: { validation: 'ia' } }, `contrôle par IA (${v.passes.join(', ')}), sans relecture humaine${NB}: ${v.resultat}`);
}
/**
 * Un élément corrigé (surcouche de corrections) est « adapté » : son ancien contrôle ne vaut plus pour le nouveau texte.
 * Il reste « à recontrôler » sauf si une surcouche de contrôle le couvre explicitement après correction
 * (`apresCorrection: ['C-00xx', …]`). La mention « corrigé (C-00xx) » est toujours affichée.
 */
export function etiquetteValidation(ctx, loc) {
  const v = ctx.validation.de(loc);
  const ids = ctx.cat?.corrections?.de(loc);
  if (!ids) return etiquetteBrute(v);
  const couvert = typeof v !== 'string' && ids.every((i) => v.apresCorrection?.includes(i));
  return h('span', { class: 'validation-corrige' },
    couvert ? etiquetteBrute(v) : h('span', { class: 'validation', dataset: { validation: 'a-recontroler' } }, 'à recontrôler après correction'),
    ' · ', h('span', { class: 'mention-correction', dataset: { correction: ids.join(' ') } }, `corrigé (${ids.join(', ')})`));
}
const meta = (ctx, loc) => h('span', { class: 'meta-element' }, etiquetteValidation(ctx, loc));

function sectionIntro(ctx, l) {
  return [h('p', { class: 'texte' }, melange(l.champs.intro))];
}
function sectionGrammaire(ctx, l) {
  return l.grammaire.map((g, i) => h('article', { class: 'gram', 'aria-labelledby': `g-${l.numero}-${i}` },
    h('h3', { id: `g-${l.numero}-${i}` }, jaFurigana(g.motif)), meta(ctx, g.loc),
    h('dl', { class: 'gram-def' },
      h('dt', {}, 'Forme'), h('dd', {}, melange(g.forme)),
      h('dt', {}, 'Sens'), h('dd', {}, melange(g.sens)),
      h('dt', {}, 'Explication'), h('dd', {}, melange(g.explication))),
    g.exemples.length ? h('div', { class: 'exemples' }, h('p', { class: 'sous-rubrique' }, 'Exemples'),
      h('ul', {}, ...g.exemples.map((e) => h('li', {}, jaFurigana(e.jp, 'p', { class: 'ex-jp' }), h('p', { class: 'ex-fr' }, brut(e.fr)), meta(ctx, e.loc))))) : null));
}
function sectionVocabulaire(ctx, l) {
  return [h('ul', { class: 'vocab' }, ...l.vocabulaire.map((v) => h('li', {}, ja(v.mot), ' ', h('span', { class: 'lecture', lang: 'ja' }, brut(v.lecture)), ' ', h('span', { class: 'sens' }, brut(v.sens)), ' ', meta(ctx, v.loc))))];
}
function sectionKanji(ctx, l) {
  return [h('ul', { class: 'kanjis' }, ...l.kanji.map((k) => h('li', { class: 'kanji' },
    h('span', { class: 'kanji-car', lang: 'ja' }, brut(k.caractere)),
    h('dl', {}, h('dt', {}, 'Sens'), h('dd', {}, brut(k.sens)),
      h('dt', {}, 'Lecture on'), h('dd', { lang: 'ja' }, brut(k.on || '—')), h('dt', {}, 'Lecture kun'), h('dd', { lang: 'ja' }, brut(k.kun || '—')),
      h('dt', {}, 'Exemples'), h('dd', {}, jaFurigana(k.exemples))),
    meta(ctx, k.loc))))];
}
function sectionLecture(ctx, l) {
  const t = l.lecture;
  return [h('p', { class: 'sous-rubrique' }, jaFurigana(t.title)), meta(ctx, t.loc), ...t.paras.map((p) => jaFurigana(p, 'p', { class: 'lecture-texte' }))];
}
function sectionEcoute(ctx, l) { return blocEcoute(ctx, l.ecoute, 'ecoute'); }
/** Dialogue à écouter : lecture seulement sur action ; transcription repliable. `e` : {title, lines, loc?}. */
function blocEcoute(ctx, e, id) {
  const etat = h('p', { class: 'aide-courte', role: 'status' });
  const phrases = e.lines.map((x) => sansFurigana(x[1]));
  const LIB = 'Écouter le dialogue', STOP = 'Arrêter la lecture';
  let arret = null, bloque = false;
  const btn = bouton(LIB, 'btn-secondaire', async () => {
    if (bloque) return;
    if (arret) { arret(); arret = null; btn.textContent = LIB; etat.textContent = 'Lecture arrêtée.'; return; }
    etat.textContent = 'Lecture en cours.'; btn.textContent = STOP;
    arret = lire(phrases, {
      fin: () => { arret = null; btn.textContent = LIB; etat.textContent = 'Lecture terminée.'; },
      erreur: () => { arret = null; btn.textContent = LIB; etat.textContent = 'La lecture a échoué : la voix du navigateur n’a pas répondu. Le texte reste lisible ci-dessous.'; },
    });
  });
  const maj = () => {
    const active = lirePref(ctx.journal, 'voix.active', true), voix = voixJaponaise();
    bloque = !active || !voix;
    if (bloque) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
    if (arret) return;
    etat.textContent = !active ? 'La synthèse vocale est désactivée dans les réglages.' : !voix ? 'Synthèse vocale indisponible : aucune voix japonaise n’est installée sur cet appareil. Le texte reste lisible ci-dessous.' : 'Une voix japonaise est disponible. La lecture ne démarre que sur votre action.';
  };
  maj();
  return { maj, noeuds: [h('p', { class: 'sous-rubrique' }, jaFurigana(e.title)), e.loc ? meta(ctx, e.loc) : null, h('div', { class: 'barre-actions' }, btn), etat,
    h('details', { class: 'transcription', id: `${id}-transcription` }, h('summary', {}, 'Afficher la transcription'),
      h('ul', { class: 'dialogue' }, ...e.lines.map((x) => h('li', {}, h('span', { class: 'locuteur' }, `${x[0] === 'F' ? 'Femme' : x[0] === 'M' ? 'Homme' : x[0]}${NB}: `), jaFurigana(x[1])))))] };
}
/** Tous les items du niveau de la leçon (examen blanc) : sert seulement à rapporter, par `selectionner`, pourquoi aucun examen n'est proposé. */
const poolDeTout = (ctx, niveau) => ctx.cat.lecons().filter((x) => x.niveau === niveau).flatMap((x) => poolComplet(x));
/** Unités de méthode et bilans (6, 12, 18, 24, 30, 36, 42, 51 ; 52 à 55) : ce que le catalogue contient, rien de plus. Une interaction absente est annoncée. */
function sectionsMethode(ctx, l) {
  const c = l.champs, out = [], majs = [];
  const sec = (id, titre, ...noeuds) => out.push(h('section', { class: 'section', id: `s-${id}`, 'aria-labelledby': `t-${id}` }, h('h2', { id: `t-${id}` }, titre), ...noeuds));
  const conseils = () => (Array.isArray(c.tips) ? [h('ul', { class: 'conseils' }, ...c.tips.map((t) => h('li', {}, h('strong', {}, melange(t[0])), h('p', {}, melange(t[1])))))] : []);
  const exercices = (pool) => sec('quiz', 'Exercices', sectionExercices(ctx, l, ctx.itemsExercices ? ctx.itemsExercices(l) : pool).element);
  if (c.bilan) {
    const unites = (c.units ?? []).map((n) => ctx.cat.lecon(n)).filter(Boolean);
    sec('bilan', `Bilan du module`, h('p', {}, 'Relisez la synthèse du module, puis passez le test : les questions manquées sont regroupées par unité pour cibler ce qu’il faut revoir.'),
      h('ul', { class: 'bilan-unites' }, ...unites.map((u) => h('li', {}, lien(hashPour('lecon', u.numero), `Leçon ${u.numero} · ${u.titre}`),
        u.grammaire.length ? h('ul', {}, ...u.grammaire.map((g) => h('li', {}, jaFurigana(g.motif)))) : null))));
    exercices(unites.flatMap((u) => poolComplet(u)));
  } else if (c.kind === 'lecture') {
    sec('textes', 'Textes d’entraînement', ...conseils(), ...(c.texts ?? []).map((t, i) => h('article', { class: 'texte-entrainement', 'aria-labelledby': `txt-${i}` },
      h('h3', { id: `txt-${i}` }, jaFurigana(t.title)), h('p', { class: 'aide-courte' }, jaFurigana(t.type), ` · environ ${t.min} min`), ...t.paras.map((p) => jaFurigana(p, 'p', { class: 'lecture-texte' })))));
    exercices(poolSpecial(l));
  } else if (c.kind === 'ecoute') {
    const blocs = (c.items ?? []).map((it, i) => { const b = blocEcoute(ctx, { title: it.type, lines: it.lines }, `ec-${i}`); majs.push(b.maj); return h('article', { class: 'texte-entrainement' }, ...b.noeuds); });
    sec('ecoutes', 'Écoutes d’entraînement', ...conseils(), ...blocs);
    exercices(poolSpecial(l));
  } else if (c.kind === 'pratique') {
    // Unités d'entraînement aux formats de l'épreuve (N3 125-127, N2 206-208) : conseils, puis les questions du corpus en séries.
    const formats = [...new Set((c.items ?? []).map((it) => it.type).filter(Boolean))];
    sec('pratique', 'Entraînement aux formats de l’épreuve', ...conseils(),
      formats.length ? h('p', {}, `Formats travaillés${NB}: `, ...formats.flatMap((t, k) => [k ? ', ' : '', jaFurigana(t, 'span')]), '.') : null,
      h('p', { class: 'aide-courte' }, `${(c.items ?? []).length} questions, proposées par séries dans la section suivante.`));
    exercices(poolSpecial(l));
  } else if (c.kind === 'examen') {
    const examen = selectionnerExamen(poolDeTout(ctx, l.niveau), { n: 30, graine: l.numero });
    sec('examen', 'Examen blanc', h('p', {}, melange(c.intro)),
      note({ type: 'info', texte: 'L’examen blanc chronométré n’est pas proposé dans cette version : un examen n’admet que des questions dont le niveau est vérifié par deux repères indépendants, et aucun item estimé n’est ajouté pour le compléter.' }),
      h('p', { class: 'aide-courte' }, `Motif : ${examen.rapport.motif ?? 'aucun'}.`));
  } else if (c.kind === 'diag') {
    sec('diag', 'Bilan par compétence', h('p', {}, melange(c.intro)),
      h('ul', { class: 'resultat-competences' }, ...Object.values(COMPETENCES).map((n) => h('li', {}, h('strong', {}, n), ' : non évaluée, aucune preuve enregistrée.'))),
      note({ type: 'info', texte: 'Les résultats par compétence et par module, et les critères de passage au N3, ne sont pas calculés dans cette version : ils exigent des épreuves à niveau vérifié.' }),
      h('p', {}, lien('#/positionnement', 'Faire le point sur mon niveau')));
  }
  return { sections: out, majs };
}

/** Nuances (V1, N3 et N2) : texte explicatif qui distingue des formes proches. */
function sectionNuance(ctx, l) {
  return [h('p', { class: 'texte' }, melange(l.champs.nuance)), meta(ctx, `${l.loc}#nuance`)];
}
/** Production (V1, N3 et N2) : phrase française à rendre en japonais ; un modèle se compare, sans note (aucune correction automatique d'une phrase libre). */
function sectionProduction(ctx, l) {
  return [h('p', { class: 'aide-courte' }, `Écrivez la phrase en japonais, puis comparez-la avec un modèle${NB}: plusieurs formulations peuvent être justes. Vérifiez surtout la forme indiquée entre parenthèses. Rien n’est noté.`),
    h('ol', { class: 'production' }, ...l.champs.prod.map((p, i) => {
      const id = `prod-${l.numero}-${i}`;
      const modele = h('div', { class: 'prod-modele', id: `${id}-modele`, hidden: true },
        h('p', { class: 'sous-rubrique' }, 'Un modèle de réponse'), jaFurigana(p[1], 'p', { class: 'ex-jp' }), meta(ctx, `${l.loc}#prod${i}`));
      const btn = h('button', { type: 'button', class: 'btn btn-secondaire', 'aria-expanded': 'false', 'aria-controls': `${id}-modele`, on: { click: () => {
        const ouvrir = modele.hidden; modele.hidden = !ouvrir; btn.setAttribute('aria-expanded', String(ouvrir)); btn.textContent = ouvrir ? 'Masquer le modèle' : 'Comparer avec un modèle';
      } } }, 'Comparer avec un modèle');
      return h('li', { class: 'prod-item' }, h('label', { for: `${id}-saisie`, class: 'prod-consigne' }, melange(p[0])),
        h('textarea', { id: `${id}-saisie`, class: 'prod-saisie', lang: 'ja', rows: '2', autocomplete: 'off', spellcheck: 'false' }),
        h('div', { class: 'barre-actions' }, btn), modele);
    }))];
}

const CONTENU = { intro: sectionIntro, grammar: sectionGrammaire, nuance: sectionNuance, prod: sectionProduction, vocab: sectionVocabulaire, kanji: sectionKanji, reading: sectionLecture };

export function vueLecon(ctx, { numero }) {
  const l = ctx.cat.lecon(numero);
  if (!l || !NIVEAUX_OUVERTS.includes(l.niveau)) return vueIntrouvableLecon(numero);
  const racine = h('div', { class: 'vue vue-lecon' });
  const secs = sectionsDeLecon(l), majs = [];
  const prefs = () => ctx.prefs();
  const etat = h('p', { class: 'etat-lecon', role: 'status' });
  const bar = barre('lecon-prog', 'Sections étudiées', 0, Math.max(secs.length, 1), 'Sections étudiées');
  const btnLecon = bouton('Marquer toute la leçon comme étudiée', 'btn-secondaire', async () => {
    const cible = !leconMarquee(prefs(), l.numero);
    try { const r = await marquerEtude(ctx.journal, l.numero, null, cible); ctx.confirmer(r, cible ? 'Leçon marquée comme étudiée.' : 'Marque « leçon étudiée » retirée.'); } catch (e) { ctx.echec(e); }
    maj();
  });
  const sw = interrupteur('lecon-furigana', 'Afficher les furigana', lirePref(ctx.journal, 'affichage.furigana', true), async (on) => {
    try { const r = await reglerPref(ctx.journal, 'affichage.furigana', on); ctx.confirmer(r, on ? 'Furigana affichés.' : 'Furigana masqués.'); } catch (e) { ctx.echec(e); sw.regler(!on); }
  });
  const pool = ctx.itemsExercices ? ctx.itemsExercices(l) : poolComplet(l);
  racine.append(
    h('p', { class: 'fil' }, lien(hashPour('parcours', l.niveau), `← Parcours ${l.niveau}`)),
    h('h1', { tabindex: '-1' }, `Leçon ${l.numero} · ${l.titre}`),
    l.sousTitre ? h('p', { class: 'sous-titre' }, melange(l.sousTitre)) : null,
    h('p', { class: 'meta-lecon' }, h('span', { class: 'etiquette' }, label({ statut: l.statutNiveau, niveau: l.niveau })), ' ', h('span', {}, `Module ${l.module + 1}`)),
    h('details', { class: 'aide-niveau' }, h('summary', {}, 'Que signifie « estimé » ?'),
      h('p', {}, 'Ce niveau vient du contenu d’origine de KOTONOHA. Il n’a pas encore été vérifié par deux références indépendantes : c’est une estimation, pas un classement JLPT. Chaque contenu indique aussi s’il a fait l’objet d’un contrôle.')),
    h('div', { class: 'carte barre-lecon' }, bar.element, etat, h('div', { class: 'barre-actions' }, btnLecon, sw.element)));
  for (const cle of l.ordreChamps) {
    if (cle === 'quiz') {
      if (!pool.length) continue;
      racine.append(h('section', { class: 'section', id: 's-quiz', 'aria-labelledby': 't-quiz' }, h('h2', { id: 't-quiz' }, 'Exercices'), sectionExercices(ctx, l, pool).element));
      continue;
    }
    const info = secs.find((s) => s.cle === cle);
    if (!info) continue;
    let noeuds;
    if (cle === 'listen') { const s = sectionEcoute(ctx, l); noeuds = s.noeuds; majs.push(s.maj); } else noeuds = CONTENU[cle](ctx, l);
    const coche = caseACocher(`etude-${cle}`, 'Section étudiée', sectionEtudiee(prefs(), l.numero, cle), async (cochee, input) => {
      try {
        const r = await marquerEtude(ctx.journal, l.numero, cle, cochee);
        ctx.confirmer(r, cochee ? `Section « ${info.libelle} » marquée comme étudiée.` : `Section « ${info.libelle} » retirée des sections étudiées.`);
      } catch (e) { ctx.echec(e); input.checked = !cochee; }
      maj();
    });
    majs.push(() => { coche.input.checked = sectionEtudiee(prefs(), l.numero, cle); });
    racine.append(h('section', { class: 'section', id: `s-${cle}`, 'aria-labelledby': `t-${cle}` }, h('h2', { id: `t-${cle}` }, info.libelle), ...noeuds, h('div', { class: 'coche-section' }, coche.element)));
  }
  if (l.champs.kind || l.champs.bilan) { const m = sectionsMethode(ctx, l); racine.append(...m.sections); majs.push(...m.majs); }
  function maj() {
    const e = etatLecon(l, prefs());
    bar.maj(e.faites, Math.max(e.total, 1));
    etat.textContent = e.etat === 'terminee' ? 'Leçon terminée.' : e.etat === 'en-cours' ? 'Leçon en cours.' : 'Leçon non commencée.';
    btnLecon.textContent = leconMarquee(prefs(), l.numero) ? 'Retirer la marque « leçon étudiée »' : 'Marquer toute la leçon comme étudiée';
    sw.regler(lirePref(ctx.journal, 'affichage.furigana', true));
    for (const f of majs) f();
  }
  maj();
  return { titre: `Leçon ${l.numero} · ${l.titre}`, element: racine, maj, fin: surVoix(maj) };
}

export function vueIntrouvableLecon(numero) {
  return { titre: 'Leçon introuvable', element: h('div', { class: 'vue' }, h('h1', { tabindex: '-1' }, 'Leçon introuvable'), h('p', {}, `La leçon ${numero} n’existe pas dans cette version.`), lien(hashPour('parcours'), 'Retour au parcours')) };
}
