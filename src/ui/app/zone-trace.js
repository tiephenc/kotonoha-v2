// KOTONOHA 2.0 · zone de tracé d'un kana (écriture interactive) : surface SVG où l'on écrit au doigt, à la souris ou au stylet
// (Pointer Events), superposition du modèle KanjiVG (traits colorés et numérotés, animation facultative), et adaptateur `reponseTrace`
// pour `jouerSerie` (vue-exercices.js). L'interface ne fait aucun calcul de correction : elle remet les traits (cadre 109 × 109) à
// `corriger` (core/kana-trace.js). Surface SVG : indépendante de la densité de pixels de l'écran, nette à toute taille.
// Politique de sécurité du contenu : aucun attribut `style` ; l'animation passe par des classes et par l'API CSSOM.
import { h } from './dom.js';
import { preparerModele, corriger, polylignePourChemin, longueur, SEUILS, CADRE } from '../../core/kana-trace.js';
import { preparerDisposition, corrigerDisposition, boiteAttendue } from '../../core/kana-yoon.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...enfants) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const e of enfants) if (e != null) el.append(e);
  return el;
};
const NB_COULEURS = 6;
/** Petit écart minimal (cadre 109) entre deux points d'un même trait. */
const PAS_MIN = 0.4;
const reduit = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Calque du modèle : un chemin par trait, coloré et numéroté au point de départ ; `fautifs` (numéros 1-based) en garance épaisse.
 * Avec une `disposition` (yōon, petit kana : core/kana-yoon.js), chaque partie est réduite et placée dans la zone (transformation SVG) ;
 * l'épaisseur du trait est compensée (variable CSS `--zt-k`) et les numéros restent à taille constante.
 * @param {string[]} chemins @param {{anime?: boolean, fautifs?: number[], guide?: boolean, disposition?: object|null}} [o] `guide` : gabarit discret, sans couleurs ni numéros
 */
export function calqueModele(chemins, { anime = false, fautifs = [], guide = false, disposition = null } = {}) {
  const g = s('g', { class: `zt-modele${guide ? ' zt-guide' : ''}${anime && !reduit() ? ' zt-anime' : ''}`, 'aria-hidden': 'true' });
  const largeur = disposition?.largeur ?? CADRE;
  const parties = disposition?.parties ?? [{ traits: chemins, echelle: 1, dx: 0, dy: 0 }];
  let i = 0;
  for (const part of parties) {
    const identite = part.echelle === 1 && part.dx === 0 && part.dy === 0;
    const sous = identite ? g : s('g', { transform: `translate(${part.dx.toFixed(3)} ${part.dy.toFixed(3)}) scale(${part.echelle})` });
    if (!identite) { sous.style.setProperty('--zt-k', String(1 / part.echelle)); g.append(sous); }
    const nums = [];
    for (const d of part.traits) {
      const faute = fautifs.includes(i + 1);
      const p = s('path', { d, pathLength: '1', class: `zt-trait zt-c${i % NB_COULEURS}${faute ? ' zt-faute' : ''}` });
      p.style.setProperty('--i', String(i));
      sous.append(p);
      if (!guide) {
        const [x0, y0] = polylignePourChemin(d)[0];
        const x = x0 * part.echelle + part.dx, y = y0 * part.echelle + part.dy;
        const cx = Math.min(largeur - 5, Math.max(5, x - 4)), cy = Math.min(CADRE - 5, Math.max(5, y - 4));
        const num = s('g', { class: `zt-num zt-c${i % NB_COULEURS}${faute ? ' zt-faute' : ''}` }, s('circle', { cx, cy, r: 4.6 }), s('text', { x: cx, y: cy + 0.4, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, String(i + 1)));
        num.style.setProperty('--i', String(i));
        nums.push(num);
      }
      i++;
    }
    g.append(...nums);
  }
  return g;
}

/**
 * Aperçu autonome d'un signe : le modèle numéroté dans son cadre (présentation, leçon).
 * @param {string[]} chemins @param {{anime?: boolean, titre?: string, disposition?: object|null}} [o]
 */
export function svgModele(chemins, { anime = false, titre = '', disposition = null } = {}) {
  const largeur = disposition?.largeur ?? CADRE;
  const svg = s('svg', { viewBox: `0 0 ${largeur} ${CADRE}`, class: `zt-apercu${largeur > CADRE ? ' zt-apercu-large' : ''}`, role: 'img', 'aria-label': titre || 'Ordre des traits du signe' });
  svg.append(grille(disposition), calqueModele(chemins, { anime, disposition }));
  return svg;
}

/** Grille : bord, axes de la case, séparation des deux cases d'un yōon, emplacement du petit signe (repère discret, jamais le modèle). */
function grille(disposition = null) {
  const largeur = disposition?.largeur ?? CADRE;
  const g = s('g', { class: 'zt-grille', 'aria-hidden': 'true' });
  const m = CADRE / 2;
  g.append(s('rect', { x: 0.5, y: 0.5, width: largeur - 1, height: CADRE - 1, class: 'zt-bord' }),
    s('line', { x1: m, y1: 0, x2: m, y2: CADRE }), s('line', { x1: 0, y1: m, x2: largeur, y2: m }));
  if (largeur > CADRE) g.append(s('line', { x1: CADRE, y1: 0, x2: CADRE, y2: CADRE, class: 'zt-sep' }));
  for (const p of disposition?.parties ?? []) {
    if (!p.petit) continue;
    const b = boiteAttendue(p), marge = 5;
    g.append(s('rect', { x: (b.x0 - marge).toFixed(2), y: (b.y0 - marge).toFixed(2), width: (b.x1 - b.x0 + 2 * marge).toFixed(2), height: (b.y1 - b.y0 + 2 * marge).toFixed(2), rx: 3, class: 'zt-emplacement' }));
  }
  return g;
}

/**
 * Zone de tracé. `traces()` rend les traits dans le cadre 109 × 109 (points [x, y]).
 * Avec une `disposition` (core/kana-yoon.js), la zone est plus large (deux cases pour un yōon) et le tracé est rendu dans ce repère.
 * @param {{id: string, chemins: string[], disposition?: object|null, etiquette?: string, surChangement?: (nb: number) => void}} o
 */
export function creerZoneTrace({ id, chemins, disposition = null, etiquette = 'Zone de tracé', surChangement = () => {} }) {
  const largeur = disposition?.largeur ?? CADRE;
  const svg = s('svg', { viewBox: `0 0 ${largeur} ${CADRE}`, class: 'zt-svg', id: `${id}-svg`, role: 'img', 'aria-label': `${etiquette}. Tracez avec le doigt, la souris ou le stylet ; les boutons ci-dessous effacent ou montrent le modèle.` });
  const couche = s('g', { class: 'zt-user' });
  let guide = null, resultat = null;
  svg.append(grille(disposition), couche);
  const traits = [];
  let courant = null, actif = null, fige = false, aide = false;

  const etat = h('p', { class: 'aide-courte zt-etat', id: `${id}-etat`, role: 'status', 'aria-live': 'polite' });
  const annoncer = (t) => { etat.textContent = t; };
  const dessin = (pts) => `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}`;
  const pt = (e) => {
    const r = svg.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * largeur, ((e.clientY - r.top) / r.height) * CADRE];
  };
  const maj = () => {
    annuler.disabled = effacer.disabled = fige || traits.length === 0;
    surChangement(traits.length);
  };
  const ajouter = (e) => {
    const evts = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of evts.length ? evts : [e]) {
      const p = pt(ev), dernier = courant.pts[courant.pts.length - 1];
      if (!dernier || Math.hypot(p[0] - dernier[0], p[1] - dernier[1]) >= PAS_MIN) courant.pts.push(p);
    }
    courant.el.setAttribute('d', dessin(courant.pts));
  };
  const terminer = (garder) => {
    if (!courant) return;
    const c = courant; courant = null;
    if (actif !== null) { try { svg.releasePointerCapture(actif); } catch { /* déjà relâché */ } }
    actif = null;
    if (garder && c.pts.length >= 2 && longueur(c.pts) >= SEUILS.longueurMin) { traits.push(c.pts); annoncer(`${traits.length} trait${traits.length > 1 ? 's' : ''} tracé${traits.length > 1 ? 's' : ''}.`); } else c.el.remove();
    maj();
  };

  svg.addEventListener('pointerdown', (e) => {
    if (fige || actif !== null || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    actif = e.pointerId;
    try { svg.setPointerCapture(e.pointerId); } catch { /* capture indisponible : le tracé reste utilisable dans la zone */ }
    const el = s('path', { class: 'zt-encre' });
    couche.append(el);
    courant = { pts: [pt(e)], el };
  });
  svg.addEventListener('pointermove', (e) => { if (courant && e.pointerId === actif) { e.preventDefault(); ajouter(e); } });
  svg.addEventListener('pointerup', (e) => { if (courant && e.pointerId === actif) { ajouter(e); terminer(true); } });
  svg.addEventListener('pointercancel', (e) => { if (courant && e.pointerId === actif) terminer(false); });
  svg.addEventListener('lostpointercapture', (e) => { if (courant && e.pointerId === actif) terminer(true); });
  svg.addEventListener('contextmenu', (e) => e.preventDefault());

  const retirerGuide = () => { guide?.remove(); guide = null; };
  const effacerTout = () => { if (fige) return; traits.length = 0; couche.replaceChildren(); annoncer('Tracé effacé.'); maj(); };
  const annulerDernier = () => { if (fige || !traits.length) return; traits.pop(); couche.lastElementChild?.remove(); annoncer(traits.length ? `Dernier trait annulé : ${traits.length} trait${traits.length > 1 ? 's' : ''} restant${traits.length > 1 ? 's' : ''}.` : 'Dernier trait annulé : il ne reste aucun trait.'); maj(); };
  const annuler = h('button', { type: 'button', class: 'btn btn-secondaire', id: `${id}-annuler`, on: { click: annulerDernier } }, 'Annuler le dernier trait');
  const effacer = h('button', { type: 'button', class: 'btn btn-secondaire', id: `${id}-effacer`, on: { click: effacerTout } }, 'Effacer');
  const montrer = h('button', { type: 'button', class: 'btn btn-secondaire', id: `${id}-modele`, 'aria-pressed': 'false', on: { click: () => {
    if (fige) return;
    if (guide) { retirerGuide(); montrer.setAttribute('aria-pressed', 'false'); montrer.textContent = 'Montrer le modèle'; annoncer('Modèle masqué.'); return; }
    aide = true;
    guide = calqueModele(chemins, { anime: true, disposition });
    svg.insertBefore(guide, couche);
    montrer.setAttribute('aria-pressed', 'true'); montrer.textContent = 'Masquer le modèle';
    annoncer(`Modèle affiché : ${chemins.length} trait${chemins.length > 1 ? 's' : ''}, numérotés dans l’ordre. Cette réponse sera enregistrée comme réponse aidée.`);
  } } }, 'Montrer le modèle');
  const actions = h('div', { class: 'barre-actions zt-actions' }, annuler, effacer, montrer);
  const element = h('div', { class: 'zone-trace', id });
  element.append(h('div', { class: largeur > CADRE ? 'zt-cadre zt-large' : 'zt-cadre' }, svg), actions, etat);
  maj();

  return {
    element, montrer, actions,
    traces: () => traits.map((t) => t.map((p) => [...p])),
    nbTraits: () => traits.length,
    aMontreModele: () => aide,
    effacer: effacerTout, annulerDernier,
    /** Fige la zone et superpose le modèle (traits colorés, numérotés ; le trait fautif en garance). */
    corriger(res, { anime = true } = {}) {
      fige = true; resultat = res;
      retirerGuide();
      couche.classList.add('zt-estompe');
      svg.append(calqueModele(chemins, { anime, fautifs: res?.fautifs ?? [], disposition }));
      annuler.disabled = effacer.disabled = montrer.disabled = true;
      svg.classList.add('zt-fige');
    },
    figer() { fige = true; if (courant) terminer(false); annuler.disabled = effacer.disabled = montrer.disabled = true; svg.classList.add('zt-fige'); },
    resultat: () => resultat,
  };
}

/** Phrase de retour d'une correction. @param {ReturnType<typeof corriger>} r */
export function messageCorrection(r) {
  if (r.abandon) return 'Pas de souci : voici le modèle, avec l’ordre des traits. Ce signe reviendra dans les révisions.';
  if (r.reussi) return `Tracé reconnu, bien joué. Score : ${r.score} sur 100 [Hyp : seuils provisoires].`;
  return `Tracé à revoir. ${r.diagnostics.map((d) => d.message).join(' ')} Le modèle est affiché, trait par trait.`;
}

/**
 * Adaptateur pour `jouerSerie` (même contrat que `reponseOptions` et `reponseOrdre`) : `lire()` rend la correction
 * (`{reussi, score, diagnostics, ...}`) ou null tant que rien n'est tracé ; `retour(r)` donne le texte affiché sous la zone.
 */
export function reponseTrace(q, n, groupe) {
  const pd = q.disposition ? preparerDisposition(q.disposition) : null, modele = pd ? null : preparerModele(q.traits);
  const etiquette = !pd ? 'Zone de tracé' : pd.parties.length > 1 ? 'Zone de tracé à deux cases : le signe, puis le petit signe en bas à sa droite' : 'Zone de tracé d’un petit signe : en bas à gauche';
  const zone = creerZoneTrace({ id: `${n}-trace`, chemins: q.traits, disposition: q.disposition ?? null, etiquette });
  let dernier = null;
  const abandon = h('button', { type: 'button', class: 'btn btn-secondaire', on: { click: () => { dernier = { reussi: false, abandon: true, score: 0, diagnostics: [], fautifs: [], nbAttendus: q.traits.length, nbTraces: zone.nbTraits() }; rep.valider?.(); } } }, 'Je ne m’en souviens pas');
  zone.actions.append(abandon);
  groupe.append(zone.element);
  const rep = {
    valider: null,
    focus: () => zone.montrer.focus(),
    lire: () => {
      if (dernier?.abandon) return dernier;
      if (zone.nbTraits() === 0) return null;
      dernier = pd ? corrigerDisposition(pd, zone.traces()) : corriger(modele, zone.traces());
      return dernier;
    },
    manque: 'Tracez d’abord le signe dans la zone, ou choisissez « Je ne m’en souviens pas ».',
    figer: () => { abandon.disabled = true; if (dernier) zone.corriger(dernier); else zone.figer(); },
    bonne: () => '',
    retour: () => messageCorrection(dernier ?? { reussi: false, diagnostics: [] }),
    /** Réponse aidée : modèle montré avant de tracer, ou signe copié depuis l'énoncé. */
    aide: () => zone.aMontreModele() || q.copie === true,
  };
  return rep;
}
