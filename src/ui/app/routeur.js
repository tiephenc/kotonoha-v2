// KOTONOHA 2.0 · routage par `location.hash` (PH-4, PREM-1). Domaine pur : aucune lecture du DOM.
// Vues : accueil, parcours (N4, N3, N2), leçon (unités 1 à 210), révisions, fiches Anki, positionnement, compte, réglages, focus. Tout le reste est « introuvable » : pas de lien mort.

export const NIVEAU_PREM1 = 'N4';
export const NB_LECONS_PREM1 = 55;
/** Niveaux ouverts dans le parcours, dans l'ordre d'étude (corpus V1 : N4 unités 1-55, N3 56-129, N2 130-210). */
export const NIVEAUX_OUVERTS = Object.freeze(['N4', 'N3', 'N2']);
export const NB_UNITES = 210;

/** @param {string} hash @returns {{vue: 'accueil'|'parcours'|'lecon'|'revision'|'anki'|'positionnement'|'compte'|'reglages'|'focus'|'pause'|'effacement'|'kana'|'introuvable', numero?: number, groupe?: string}} */
export function analyser(hash) {
  const h = String(hash ?? '').replace(/^#\/?/, '').replace(/\/+$/, '');
  if (h === '') return { vue: 'accueil' };
  const p = h.split('/');
  if (p.length === 1 && p[0] === 'parcours') return { vue: 'parcours' };
  if (p.length === 2 && p[0] === 'parcours' && NIVEAUX_OUVERTS.includes(p[1])) return { vue: 'parcours', niveau: p[1] };
  if (p.length === 1 && p[0] === 'reglages') return { vue: 'reglages' };
  if (p.length === 1 && p[0] === 'kana') return { vue: 'kana' };
  if (p.length === 2 && p[0] === 'kana' && /^(g\d{2}|longueurs)$/.test(p[1])) return { vue: 'kana', groupe: p[1] };
  // Écriture interactive des kana : `#/kana/ecrire` (liste) et `#/kana/ecrire/g01` (un groupe).
  if (p.length === 2 && p[0] === 'kana' && p[1] === 'ecrire') return { vue: 'kana', mode: 'ecrire' };
  if (p.length === 3 && p[0] === 'kana' && p[1] === 'ecrire' && /^g\d{2}$/.test(p[2])) return { vue: 'kana', mode: 'ecrire', groupe: p[2] };
  if (p.length === 1 && (p[0] === 'revision' || p[0] === 'anki' || p[0] === 'positionnement' || p[0] === 'compte' || p[0] === 'focus' || p[0] === 'pause' || p[0] === 'effacement')) return { vue: p[0] };
  if (p.length === 2 && p[0] === 'lecon' && /^[1-9]\d{0,2}$/.test(p[1])) {
    const numero = Number(p[1]);
    if (numero <= NB_UNITES) return { vue: 'lecon', numero };
  }
  return { vue: 'introuvable' };
}

/** Adresse de l'écriture des kana : sans argument la liste, sinon un groupe (`g01`). */
export const hashEcriture = (groupe) => (groupe ? `#/kana/ecrire/${groupe}` : '#/kana/ecrire');

/** Adresse (hash) d'une vue. @param {string} vue @param {number|string} [numero] (pour `kana` : identifiant du groupe) */
export function hashPour(vue, numero) {
  switch (vue) {
    case 'accueil': return '#/';
    case 'parcours': return numero && numero !== NIVEAU_PREM1 ? `#/parcours/${numero}` : '#/parcours';
    case 'reglages': return '#/reglages';
    case 'kana': return numero ? `#/kana/${numero}` : '#/kana';
    case 'revision': return '#/revision';
    case 'anki': return '#/anki';
    case 'positionnement': return '#/positionnement';
    case 'compte': return '#/compte';
    case 'focus': return '#/focus';
    case 'pause': return '#/pause';
    case 'effacement': return '#/effacement';
    case 'lecon': return `#/lecon/${numero}`;
    default: throw new RangeError(`vue inconnue : ${vue}`);
  }
}

/** Entrée de navigation principale à marquer comme courante. */
export const entreeCourante = (r) => (r.vue === 'lecon' ? 'parcours' : r.vue === 'introuvable' ? null : r.vue === 'positionnement' ? 'accueil' : r.vue === 'compte' || r.vue === 'effacement' ? 'reglages' : r.vue === 'pause' ? 'focus' : r.vue === 'anki' ? 'revision' : r.vue);
/** Vues qui ne dépendent pas du catalogue des leçons : elles s'affichent même s'il charge ou échoue. */
// `anki` : affichée sans attendre le catalogue, qui est chargé en arrière-plan pour les correspondances avec les leçons.
export const SANS_CATALOGUE = Object.freeze(['anki', 'reglages', 'revision', 'positionnement', 'compte', 'focus', 'pause', 'effacement', 'kana', 'introuvable']);
