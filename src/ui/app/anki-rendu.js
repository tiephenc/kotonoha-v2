// KOTONOHA 2.0 · affichage d'un champ de carte Anki. Le HTML du paquet n'est JAMAIS inséré tel quel (09 SEC ; 08 §19.15) :
// il est analysé hors document (DOMParser, inerte : aucun script, aucun chargement), puis reconstruit nœud par nœud avec une
// liste blanche (ruby, rt, rp, br, b, i, u, em, strong, sub, sup, div, p), sans aucun attribut. Les médias (images, sons) ne sont
// pas importés : ils sont retirés de l'affichage. Les gabarits Anki ne sont jamais exécutés (lus pour savoir quel champ va où).
const GARDES = new Set(['RUBY', 'RT', 'RP', 'BR', 'B', 'I', 'U', 'EM', 'STRONG', 'SUB', 'SUP', 'DIV', 'P']);
const RETIRES = new Set(['SCRIPT', 'STYLE', 'IMG', 'AUDIO', 'VIDEO', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'FORM', 'HEAD', 'TITLE']);

/** Furigana d'Anki « 漢字[かんじ] » : segments { base, lecture }. */
function segmentsFurigana(t) {
  const out = []; let i = 0;
  for (const m of t.matchAll(/ ?([^ \[\]]+)\[([^\]]*)\]/g)) {
    if (m.index > i) out.push({ base: t.slice(i, m.index) });
    out.push({ base: m[1], lecture: m[2] }); i = m.index + m[0].length;
  }
  if (i < t.length) out.push({ base: t.slice(i) });
  return out;
}

/** Texte d'un nœud, avec le filtre Anki du gabarit (furigana, kana, kanji) ; balises de son retirées. */
function texte(doc, t, filtre) {
  const s = t.replace(/\[sound:[^\]]*\]/g, '');
  const frag = doc.createDocumentFragment();
  if (filtre !== 'furigana' && filtre !== 'kana' && filtre !== 'kanji') { frag.append(doc.createTextNode(s)); return frag; }
  for (const seg of segmentsFurigana(s)) {
    if (seg.lecture === undefined) frag.append(doc.createTextNode(seg.base));
    else if (filtre === 'kana') frag.append(doc.createTextNode(seg.lecture));
    else if (filtre === 'kanji') frag.append(doc.createTextNode(seg.base));
    else { const r = doc.createElement('ruby'); r.append(doc.createTextNode(seg.base)); const rt = doc.createElement('rt'); rt.textContent = seg.lecture; r.append(rt); frag.append(r); }
  }
  return frag;
}

/** Texte à trous (modèle « Cloze ») : le trou n° `n` est caché (recto) ou mis en évidence (verso) ; les autres sont montrés. */
export function remplacerTrous(html, n, revele) {
  return String(html).replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_, k, txt, indice) => {
    if (Number(k) !== n) return txt;
    return revele ? `<b>${txt}</b>` : `<b>[${indice ? indice : '…'}]</b>`;
  });
}

/**
 * Fragment DOM sûr pour un champ Anki.
 * @param {string} html valeur brute du champ @param {{filtre?: string|null, trou?: number|null, revele?: boolean, doc?: Document}} [o]
 */
export function champSur(html, { filtre = null, trou = null, revele = false, doc = document } = {}) {
  const source = filtre === 'cloze' && trou ? remplacerTrous(html, trou, revele) : String(html ?? '');
  const analyse = new DOMParser().parseFromString(`<body>${source}</body>`, 'text/html');
  const frag = doc.createDocumentFragment();
  const copier = (n, dest) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { dest.append(texte(doc, c.nodeValue, filtre === 'cloze' ? null : filtre)); continue; }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName.toUpperCase();
      if (RETIRES.has(tag)) continue;
      if (GARDES.has(tag)) { const e = doc.createElement(tag.toLowerCase()); copier(c, e); dest.append(e); }
      else if (tag === 'HR') dest.append(doc.createElement('br'));
      else copier(c, dest); // balise inconnue ou de mise en forme (span, font, a…) : contenu gardé, balise retirée
    }
  };
  copier(analyse.body, frag);
  return frag;
}
