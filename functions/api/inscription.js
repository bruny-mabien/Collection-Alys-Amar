// Cloudflare Pages Function — POST /api/inscription
// Reçoit le formulaire du Club littéraire et envoie : (1) un e-mail à l'organisatrice,
// (2) un accusé de réception au parent. Envoi via Resend (https://resend.com).
//
// Variables à définir dans Cloudflare Pages > Settings > Variables and Secrets :
//   RESEND_API_KEY  (secret)  clé API Resend
//   CLUB_TO_EMAIL             adresse qui reçoit les inscriptions
//   CLUB_FROM_EMAIL           expéditeur sur le domaine vérifié, ex. "Club Alys & Amar <club@alysamar.com>"

const MAX = { parent_nom: 100, parent_email: 150, parent_tel: 30, ville_pays: 100,
  enfant_prenom: 60, enfant_niveau: 60, mode: 20, message: 1000 };
const MODES = ['En ligne', 'En présentiel', 'Peu importe'];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function send(env, payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error('resend ' + r.status);
}

export async function onRequestPost({ request, env }) {
  // Même origine uniquement
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json({ error: 'Requête refusée.' }, 403);
  }
  let d;
  try { d = await request.json(); } catch { return json({ error: 'Données invalides.' }, 400); }

  // Anti-spam : champ piège rempli, ou formulaire envoyé en moins de 3 secondes
  if (d.site_web) return json({ ok: true });
  if (Date.now() - Number(d.t || 0) < 3000) return json({ error: 'Veuillez réessayer.' }, 429);

  const f = {};
  for (const k of Object.keys(MAX)) {
    f[k] = String(d[k] ?? '').trim();
    if (f[k].length > MAX[k]) return json({ error: 'Un champ est trop long.' }, 400);
  }
  const age = parseInt(d.enfant_age, 10);
  const required = ['parent_nom', 'parent_email', 'parent_tel', 'ville_pays', 'enfant_prenom', 'enfant_niveau', 'mode'];
  if (required.some((k) => !f[k]) || !(age >= 3 && age <= 17) || d.consentement !== true) {
    return json({ error: 'Merci de remplir tous les champs obligatoires.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.parent_email)) return json({ error: 'Adresse e-mail invalide.' }, 400);
  if (!MODES.includes(f.mode)) return json({ error: 'Mode de participation invalide.' }, 400);
  if (!env.RESEND_API_KEY || !env.CLUB_TO_EMAIL || !env.CLUB_FROM_EMAIL) {
    return json({ error: 'Service temporairement indisponible.' }, 503);
  }

  const rows = [
    ['Parent / tuteur', f.parent_nom], ['E-mail', f.parent_email], ['Téléphone', f.parent_tel],
    ['Ville / pays', f.ville_pays], ['Enfant (prénom)', f.enfant_prenom], ['Âge', age],
    ['Niveau', f.enfant_niveau], ['Mode', f.mode], ['Remarques', f.message || '—'],
  ];
  const table = '<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif">' +
    rows.map(([a, b]) => `<tr><td style="border:1px solid #ddd"><b>${esc(a)}</b></td><td style="border:1px solid #ddd">${esc(b)}</td></tr>`).join('') +
    '</table>';

  try {
    await send(env, {
      from: env.CLUB_FROM_EMAIL, to: [env.CLUB_TO_EMAIL], reply_to: f.parent_email,
      subject: `Nouvelle inscription au club — ${f.enfant_prenom} (${age} ans)`,
      html: `<p>Nouvelle inscription au Club littéraire Alys &amp; Amar :</p>${table}`,
    });
  } catch { return json({ error: "L'envoi a échoué. Réessayez plus tard." }, 502); }

  // Accusé de réception au parent (un échec ici ne doit pas faire échouer l'inscription)
  try {
    await send(env, {
      from: env.CLUB_FROM_EMAIL, to: [f.parent_email],
      subject: 'Inscription reçue — Club littéraire Alys & Amar',
      html: `<p>Bonjour ${esc(f.parent_nom)},</p><p>Nous avons bien reçu l'inscription de <b>${esc(f.enfant_prenom)}</b> au Club littéraire Alys &amp; Amar. Nous vous recontactons très bientôt.</p><p>« Lire, créer, rêver et transmettre »</p>`,
    });
  } catch {}

  return json({ ok: true });
}

export const onRequest = () => json({ error: 'Méthode non autorisée.' }, 405);
