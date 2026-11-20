// KOTONOHA 2.0 · construction du DOM par nœuds (jamais `innerHTML` sur une donnée) et typographie française.
import { segmenterFurigana, sansFurigana } from '../../core/catalogue.js';

export const NB = ' ';
/** Typographie française des textes d'interface : espace insécable avant « : ; ? ! » et à l'intérieur des guillemets. */
export const fr = (s) => String(s).replace(/ ([:;?!»])/g, NB + '$1').replace(/« /g, '«' + NB);
/** Texte de donnée, laissé tel quel. */
export const brut = (s) => document.createTextNode(String(s));

const poser = (el, k, v) => {
  if (v === false || v == null) return;
  if (k === 'class') el.className = v;
  else if (k === 'on') for (const [ev, f] of Object.entries(v)) el.addEventListener(ev, f);
  else if (k === 'dataset') Object.assign(el.dataset, v);
  else if (k === 'text') el.textContent = fr(v);
  else el.setAttribute(k, v === true ? '' : String(v));
};
/** Crée un élément. Les enfants textuels reçoivent la typographie française ; les nœuds restent intacts. */
export function h(tag, props = {}, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) poser(el, k, v);
  ajouter(el, enfants);
  return el;
}
export function ajouter(el, enfants) {
  for (const c of enfants.flat(Infinity)) { if (c == null || c === false) continue; el.append(typeof c === 'string' ? fr(c) : c); }
  return el;
}

/** Segment de japonais (langue déclarée pour les technologies d'assistance). */
export const ja = (texte, tag = 'span') => h(tag, { lang: 'ja' }, brut(texte));

/**
 * Texte V1 à furigana « 漢字{かんじ} » -> fragment avec <ruby>. Les lectures restent dans le DOM : le masquage est une règle CSS
 * (`data-furigana="masque"` sur <html>), donc instantané et sans reconstruction. Forme mal construite : texte sans furigana.
 */
export function furigana(texte) {
  const f = document.createDocumentFragment();
  let segs;
  try { segs = segmenterFurigana(texte); } catch { f.append(brut(sansFurigana(texte))); return f; }
  for (const s of segs) {
    if (!s.lecture) { f.append(brut(s.base)); continue; }
    const r = document.createElement('ruby');
    const rp1 = document.createElement('rp'); rp1.textContent = '(';
    const rt = document.createElement('rt'); rt.textContent = s.lecture;
    const rp2 = document.createElement('rp'); rp2.textContent = ')';
    r.append(brut(s.base), rp1, rt, rp2); f.append(r);
  }
  return f;
}
/** Bloc ou ligne de japonais avec furigana, balisé lang="ja". */
export const jaFurigana = (texte, tag = 'span', props = {}) => h(tag, { lang: 'ja', ...props }, furigana(texte));

const SUITE_JA = /[぀-ヿ㐀-鿿豈-﫿、。々「-』〜！-｠…{}]+/gu;
/** Texte français contenant du japonais : chaque suite japonaise (avec ses furigana) est balisée lang="ja". */
export function melange(texte) {
  const f = document.createDocumentFragment();
  let dernier = 0;
  for (const m of String(texte).matchAll(SUITE_JA)) {
    if (m.index > dernier) f.append(brut(texte.slice(dernier, m.index)));
    f.append(jaFurigana(m[0])); dernier = m.index + m[0].length;
  }
  if (dernier < texte.length) f.append(brut(texte.slice(dernier)));
  return f;
}
