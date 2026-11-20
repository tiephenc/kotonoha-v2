'use strict';
const n = document.getElementById('compteur');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (const id of ['b-principal', 'b-secondaire', 'b-discret', 'b-outil', 'b-desactive', 'b-teinte']) KDS.action(document.getElementById(id), async () => { await wait(300); n.textContent = String(Number(n.textContent) + 1); });
const input = document.getElementById('reponse');
KDS.saisieJaponaise(input, (v) => {
  if (!/^[\u3041-\u309F\u30A0-\u30FFー]+$/.test(v)) return KDS.erreurChamp(input, 'Écrivez la lecture en kana, par exemple じゅんび.');
  KDS.erreurChamp(input, ''); document.getElementById('soumis').textContent = v;
});
document.getElementById('f-reponse').addEventListener('submit', (e) => e.preventDefault());
