const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN_TTL_SECONDS = 120;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));

const dataPath = path.join(__dirname, 'data', 'beneficiaries.json');
let beneficiaries = [];
try {
  beneficiaries = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (error) {
  console.error('Impossible de charger data/beneficiaries.json', error);
  process.exit(1);
}

const tokens = new Map();
const logs = [];

function getBaseUrl(req) {
  const envUrl = process.env.PUBLIC_BASE_URL;
  if (envUrl && envUrl.trim()) return envUrl.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function findBeneficiary(id) {
  return beneficiaries.find((b) => b.id === id);
}

function maskPhone(phone) {
  if (!phone || phone.length < 4) return 'Non renseigné';
  return `${phone.slice(0, 2)} ** ** ** ${phone.slice(-2)}`;
}

function isActive(beneficiary) {
  if (!beneficiary) return false;
  if (beneficiary.status !== 'active') return false;
  if (beneficiary.validUntil) {
    const today = new Date();
    const validDate = new Date(`${beneficiary.validUntil}T23:59:59`);
    if (today > validDate) return false;
  }
  return true;
}

function layout(title, body) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="/public/styles.css" />
</head>
<body>
  ${body}
  <footer class="footer">
    <a href="/mentions-legales">Mentions légales</a>
    <span>·</span>
    <a href="/confidentialite">Données personnelles</a>
  </footer>
</body>
</html>`;
}

app.get('/', (req, res) => {
  res.redirect('/card/MER-0001');
});

app.get('/card/:id', (req, res) => {
  const beneficiary = findBeneficiary(req.params.id);
  if (!beneficiary) {
    return res.status(404).send(layout('Pass introuvable', '<main class="shell"><section class="card"><h1>Pass introuvable</h1><p>Ce bénéficiaire n’existe pas.</p></section></main>'));
  }

  const advantages = beneficiary.advantages.map((adv) => `<li><strong>${adv.name}</strong><span>${adv.description}</span></li>`).join('');
  const statusClass = isActive(beneficiary) ? 'ok' : 'ko';
  const statusLabel = isActive(beneficiary) ? 'Actif' : 'Inactif / expiré';

  res.send(layout('Pass Avantages', `
    <main class="shell">
      <section class="pass-card">
        <div class="brand-row">
          <div class="brand-mark">M+</div>
          <div>
            <p class="eyebrow">Pass Avantages</p>
            <h1>Mericq / Padel+</h1>
          </div>
        </div>

        <div class="identity">
          <p class="name">${beneficiary.firstName} ${beneficiary.lastName}</p>
          <p class="role">${beneficiary.type}</p>
          <span class="status ${statusClass}">${statusLabel}</span>
        </div>

        <div class="advantages">
          <h2>Avantages actifs</h2>
          <ul>${advantages}</ul>
        </div>

        <button id="generateQr" class="primary">Afficher mon QR code</button>

        <div id="qrBlock" class="qr-block hidden">
          <p class="qr-info">QR code valable ${TOKEN_TTL_SECONDS} secondes</p>
          <img id="qrImage" alt="QR code de validation" />
          <p class="phone-check">Code de contrôle : <strong>${beneficiary.phoneLast4}</strong></p>
          <a id="testLink" class="test-link" target="_blank" rel="noopener">Tester la page de contrôle</a>
        </div>

        <p class="note">Carte strictement personnelle. Un contrôle peut être demandé en cas de doute.</p>
      </section>
    </main>

    <script>
      const beneficiaryId = ${JSON.stringify(beneficiary.id)};
      document.getElementById('generateQr').addEventListener('click', async () => {
        const response = await fetch('/api/token/' + beneficiaryId, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) {
          alert(data.error || 'Impossible de générer le QR code.');
          return;
        }
        document.getElementById('qrImage').src = data.qrImage;
        document.getElementById('testLink').href = data.verifyUrl;
        document.getElementById('qrBlock').classList.remove('hidden');
      });
    </script>
  `));
});

app.post('/api/token/:id', async (req, res) => {
  const beneficiary = findBeneficiary(req.params.id);
  if (!beneficiary) return res.status(404).json({ error: 'Bénéficiaire introuvable.' });
  if (!isActive(beneficiary)) return res.status(403).json({ error: 'Pass inactif ou expiré.' });

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_SECONDS * 1000;
  tokens.set(token, { beneficiaryId: beneficiary.id, expiresAt });

  const verifyUrl = `${getBaseUrl(req)}/verify/${token}`;
  const qrImage = await QRCode.toDataURL(verifyUrl, { margin: 2, width: 280 });

  res.json({ token, verifyUrl, qrImage, expiresAt });
});

app.get('/verify/:token', (req, res) => {
  const tokenData = tokens.get(req.params.token);
  const expired = !tokenData || Date.now() > tokenData.expiresAt;
  const beneficiary = tokenData ? findBeneficiary(tokenData.beneficiaryId) : null;

  if (expired) {
    tokens.delete(req.params.token);
    return res.status(410).send(layout('QR expiré', `
      <main class="shell"><section class="verify-card error"><h1>QR code expiré</h1><p>Demandez au bénéficiaire de générer un nouveau QR code depuis sa carte.</p></section></main>
    `));
  }

  if (!beneficiary || !isActive(beneficiary)) {
    return res.status(403).send(layout('Pass non valide', `
      <main class="shell"><section class="verify-card error"><h1>Pass non valide</h1><p>Le bénéficiaire est introuvable, inactif ou expiré.</p></section></main>
    `));
  }

  const advantages = beneficiary.advantages.map((adv) => `<li><strong>${adv.name}</strong><span>${adv.description}</span></li>`).join('');

  res.send(layout('Contrôle avantage', `
    <main class="shell">
      <section class="verify-card">
        <span class="status ok">Carte active</span>
        <h1>${beneficiary.firstName} ${beneficiary.lastName}</h1>
        <p class="role">${beneficiary.type}</p>
        <p class="muted">Téléphone enregistré : ${maskPhone(beneficiary.phone)}</p>

        <div class="advantages compact">
          <h2>Avantages autorisés</h2>
          <ul>${advantages}</ul>
        </div>

        <form method="POST" action="/verify/${req.params.token}" class="pin-form">
          <label for="phoneLast4">Saisir les 4 derniers chiffres du téléphone</label>
          <input id="phoneLast4" name="phoneLast4" inputmode="numeric" maxlength="4" autocomplete="off" required />
          <button class="primary" type="submit">Valider l’avantage</button>
        </form>
      </section>
    </main>
  `));
});

app.post('/verify/:token', (req, res) => {
  const tokenData = tokens.get(req.params.token);
  const expired = !tokenData || Date.now() > tokenData.expiresAt;
  const beneficiary = tokenData ? findBeneficiary(tokenData.beneficiaryId) : null;

  if (expired || !beneficiary || !isActive(beneficiary)) {
    return res.status(403).send(layout('Validation refusée', `<main class="shell"><section class="verify-card error"><h1>Validation refusée</h1><p>QR expiré ou pass inactif.</p></section></main>`));
  }

  const ok = String(req.body.phoneLast4 || '').trim() === beneficiary.phoneLast4;
  logs.unshift({
    date: new Date().toISOString(),
    beneficiaryId: beneficiary.id,
    name: `${beneficiary.firstName} ${beneficiary.lastName}`,
    result: ok ? 'validé' : 'refusé'
  });

  if (!ok) {
    return res.status(403).send(layout('Code incorrect', `<main class="shell"><section class="verify-card error"><h1>Code incorrect</h1><p>Les 4 chiffres saisis ne correspondent pas au bénéficiaire.</p><a href="/verify/${req.params.token}" class="test-link">Réessayer</a></section></main>`));
  }

  tokens.delete(req.params.token);
  res.send(layout('Avantage validé', `<main class="shell"><section class="verify-card success"><span class="status ok">Validé</span><h1>Avantage autorisé</h1><p>${beneficiary.firstName} ${beneficiary.lastName} — ${beneficiary.type}</p><p>Vous pouvez appliquer les avantages affichés sur la page de contrôle.</p></section></main>`));
});

app.get('/admin', (req, res) => {
  const rows = beneficiaries.map((b) => `<tr><td>${b.id}</td><td>${b.firstName} ${b.lastName}</td><td>${b.type}</td><td>${b.status}</td><td>${b.validUntil}</td><td><a href="/card/${b.id}">Voir carte</a></td></tr>`).join('');
  const logRows = logs.slice(0, 10).map((log) => `<tr><td>${new Date(log.date).toLocaleString('fr-FR')}</td><td>${log.name}</td><td>${log.result}</td></tr>`).join('') || '<tr><td colspan="3">Aucune validation pour le moment.</td></tr>';
  res.send(layout('Admin Pass Avantages', `<main class="admin-shell"><h1>Back-office prototype</h1><p>Version de démonstration, accès non protégé.</p><h2>Bénéficiaires</h2><table><thead><tr><th>ID</th><th>Nom</th><th>Type</th><th>Statut</th><th>Validité</th><th>Carte</th></tr></thead><tbody>${rows}</tbody></table><h2>Dernières validations</h2><table><thead><tr><th>Date</th><th>Bénéficiaire</th><th>Résultat</th></tr></thead><tbody>${logRows}</tbody></table></main>`));
});

app.get('/mentions-legales', (req, res) => {
  res.send(layout('Mentions légales', `<main class="content"><h1>Mentions légales</h1><p><strong>Éditeur :</strong> à compléter — Mericq / Padel+.</p><p><strong>Directeur de publication :</strong> à compléter.</p><p><strong>Contact :</strong> à compléter.</p><p><strong>Hébergement :</strong> à compléter selon l’hébergeur retenu.</p><p>Ce prototype a pour objet la vérification des avantages accordés aux salariés, partenaires et bénéficiaires autorisés.</p></main>`));
});

app.get('/confidentialite', (req, res) => {
  res.send(layout('Données personnelles', `<main class="content"><h1>Données personnelles</h1><p>Les données collectées sont utilisées uniquement pour vérifier l’éligibilité aux avantages Mericq / Padel+.</p><p>Données utilisées : nom, prénom, type de bénéficiaire, entreprise, numéro de téléphone, statut, avantages attribués et historique minimal des validations.</p><p>Les données ne sont accessibles qu’aux personnes habilitées à administrer ou contrôler les avantages.</p><p>Durée de conservation, modalités d’exercice des droits et contact RGPD : à compléter avant mise en production.</p></main>`));
});

app.listen(PORT, () => {
  console.log(`Pass Avantages lancé sur le port ${PORT}`);
});
