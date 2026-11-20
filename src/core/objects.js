// KOTONOHA 2.0 · objets de contenu hors journal (08 §19.1). Domaine pur.
// Le texte n'entre jamais dans une opération : l'opération ne porte que l'identifiant aléatoire de
// l'objet et l'empreinte salée SHA-256(sel ‖ contenu), qu'on ne peut pas retrouver par force brute.
import { newId } from './ids.js';
import { sha256 } from './canon.js';

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** @param {string} content @param {number} t */
export async function makeObject(content, t) {
  if (typeof content !== 'string') throw new Error('contenu : texte attendu');
  const salt = hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const obj = { id: newId('ku', 'obj', t), salt, content, h: await sha256(salt + content) };
  return { obj, ref: { id: obj.id, h: obj.h } };
}

/** Un objet est intact si son empreinte salée correspond à son contenu. @param {any} o */
export const objectValid = async (o) => !!o && typeof o.id === 'string' && typeof o.content === 'string' && /^[0-9a-f]{32}$/.test(o.salt) && Object.keys(o).length === 4 && o.h === (await sha256(o.salt + o.content));
