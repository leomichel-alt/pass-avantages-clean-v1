# Pass Avantages Mericq / Padel+

Prototype propre — QR dynamique + vérification par les 4 derniers chiffres du téléphone.

## Lancer en local

```bash
npm install
npm start
```

Puis ouvrir :

```text
http://localhost:3000/card/MER-0001
```

Back-office prototype :

```text
http://localhost:3000/admin
```

## Déployer sur Render

1. Créer un repository GitHub.
2. Uploader tous les fichiers en gardant la structure :

```text
server.js
package.json
data/beneficiaries.json
public/styles.css
README.md
```

3. Sur Render : New > Web Service.
4. Build command :

```bash
npm install
```

5. Start command :

```bash
npm start
```

6. Ajouter la variable d’environnement :

```text
PUBLIC_BASE_URL=https://votre-url-render.onrender.com
```

Sans slash à la fin.

## Parcours

- Le bénéficiaire ouvre sa carte.
- Il clique sur « Afficher mon QR code ».
- Le QR code est valable 120 secondes.
- L’équipe scanne le QR.
- La page de contrôle demande les 4 derniers chiffres du téléphone.
- Si le code est correct, l’avantage est validé.

## Important avant production

Cette version est un prototype. Avant utilisation réelle, prévoir :

- accès admin protégé ;
- vraie base de données ;
- gestion multi-bénéficiaires ;
- historique fiable ;
- validation RGPD ;
- domaine officiel type avantages.mericq.com.
