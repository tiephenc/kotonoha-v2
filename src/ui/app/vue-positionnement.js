// KOTONOHA 2.0 · écran Positionnement (PX-02 ; ET-01, ET-12). Entrée honnête de PREM-1 (04 §15.1 : « Cette version commence au niveau N4 »),
// test par compétences sans retour question par question, « Je ne sais pas », résultat avec confiance faible, première leçon proposée avec sa raison.
import { h, melange } from './dom.js';
import { bouton, note, lien, barre } from './composants-app.js';
import { preparerPositionnement, creerTest, MESSAGE_N4 } from '../../core/positionnement.js';
import { melangerOptions } from '../../core/melange.js';
import { enregistrerReponse } from '../../app/reponses.js';
import { graineSession } from './graine.js';
import { hashPour } from './routeur.js';

const CONFIANCE = { faible: 'confiance faible : peu de preuves', 'non-evaluee': 'non évaluée : aucune preuve' };

export function vuePositionnement(ctx) {
  const racine = h('div', { class: 'vue vue-positionnement' });
  const zone = h('div', { class: 'positionnement', 'aria-live': 'polite' });
  const prep = preparerPositionnement(ctx.itemsPositionnement ? ctx.itemsPositionnement() : []);
  racine.append(h('h1', { tabindex: '-1' }, 'Faire le point sur mon niveau'), zone);
  const actions = h('div', { class: 'barre-actions' }, lien(hashPour('lecon', 1), 'Commencer quand même au N4', 'btn btn-principal'), lien(hashPour('parcours'), 'Explorer le parcours N4', 'btn btn-secondaire'));
  const intro = () => zone.replaceChildren(
    h('p', {}, MESSAGE_N4),
    prep.disponible
      ? h('div', {}, h('p', {}, `Environ ${prep.minutes} min, ${prep.items.length} questions réparties en ${prep.sections.length} section${prep.sections.length > 1 ? 's' : ''}. Il n’y a pas de note : le but est de choisir un bon point de départ.`),
        h('p', { class: 'aide-courte' }, 'Vous pouvez répondre « Je ne sais pas » à toute question. Aucun retour n’est donné pendant le test.'),
        h('div', { class: 'barre-actions' }, bouton('Commencer le test', 'btn-principal', async () => lancer()), lien(hashPour('lecon', 1), 'Commencer quand même au N4', 'btn btn-secondaire')))
      : h('div', {}, note({ type: 'info', texte: 'Le test de positionnement n’est pas disponible pour l’instant : il ne repose que sur des questions dont le niveau est vérifié par deux repères indépendants, et aucune ne l’est encore.' }), actions));

  function lancer() {
    if (!ctx.journal.canStartActivity()) { ctx.echec(Object.assign(new Error('actions en attente'), { code: 'blocked' })); return; }
    const graine = `${graineSession()}|pos`;
    const t = creerTest(prep.items.map((q) => melangerOptions(q, graine)));
    const question = () => {
      const q = t.courant, n = `pos-${t.index}`, debut = performance.now();
      const sec = prep.sections.find((s) => s.cle === q.competence);
      const faites = prep.items.slice(0, t.index).filter((x) => x.competence === q.competence).length;
      const groupe = h('fieldset', { class: 'chk-groupe', id: n }, h('legend', { class: 'question' }, melange(q.question)));
      const radios = [...q.options.map((o) => melange(o)), 'Je ne sais pas'].map((o, k) => {
        const input = h('input', { type: 'radio', class: 'chk-input', name: n, value: k === q.options.length ? 'nsp' : String(k), id: `${n}-o${k}` });
        groupe.append(h('label', { class: 'chk chk-radio', for: `${n}-o${k}` }, input, h('span', { class: 'chk-boite', 'aria-hidden': 'true' }), h('span', {}, o)));
        return input;
      });
      const zoneProg = h('div', {}, barre(`pos-prog-${t.index}`, `Section ${sec.libelle}`, faites, sec.nb, 'Questions').element);
      const suite = bouton(t.index + 1 < t.total ? 'Valider et continuer' : 'Voir le résultat', 'btn-principal', async () => {
        const c = radios.find((r) => r.checked);
        if (!c) { zone.querySelector('.alerte-choix')?.remove(); groupe.append(h('p', { class: 'alerte-choix', role: 'alert' }, 'Choisissez une réponse, ou « Je ne sais pas ».')); return; }
        const choix = c.value === 'nsp' ? null : Number(c.value);
        if (choix !== null) {
          try {
            const res = await enregistrerReponse(ctx.journal, q, { ok: choix === q.reponse, ms: Math.round(performance.now() - debut), ctx: 'evaluation' });
            if (!res.saved) { ctx.signaler('Votre réponse n’est pas encore enregistrée sur cet appareil. Exportez les actions en attente ou réessayez avant de continuer.'); return; }
          } catch (e) { ctx.echec(e); return; }
        }
        t.repondre(choix);
        t.fini ? resultat() : question();
      });
      zone.replaceChildren(h('p', { class: 'ex-position' }, `Question ${t.index + 1} sur ${t.total} · ${sec.libelle}`), zoneProg, groupe, h('div', { class: 'barre-actions' }, suite));
      radios[0].focus();
    };
    const resultat = () => {
      const titre = h('h2', { tabindex: '-1' }, 'Résultat par compétence');
      zone.replaceChildren(titre, h('p', {}, 'Ce résultat est une première estimation, pas un niveau atteint : la confiance est faible tant que les preuves sont peu nombreuses.'),
        h('ul', { class: 'resultat-competences' }, ...t.resultat().map((c) => h('li', {}, h('strong', {}, c.libelle), ` : ${c.repondues} réponse${c.repondues > 1 ? 's' : ''}, ${c.justes} juste${c.justes > 1 ? 's' : ''}${c.nsp ? `, ${c.nsp} « Je ne sais pas »` : ''} · ${CONFIANCE[c.confiance]}`))),
        h('p', {}, h('strong', {}, 'Leçon proposée : '), 'leçon 1. Raison : c’est le début du parcours N4, et ce test n’a pas encore assez de preuves pour vous faire sauter une étape. Vous pouvez choisir une autre leçon dans le parcours.'),
        h('div', { class: 'barre-actions' }, lien(hashPour('lecon', 1), 'Commencer la leçon 1', 'btn btn-principal'), lien(hashPour('parcours'), 'Choisir une autre leçon', 'btn btn-secondaire')));
      titre.focus();
    };
    question();
  }
  intro();
  return { titre: 'Positionnement', element: racine, maj: () => {} };
}
