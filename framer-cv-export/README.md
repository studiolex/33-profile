# Framer CV Export (PDF / Word on demand)

Klein serverless endpoint dat op het moment van de klik de live Framer-pagina
ophaalt en als download teruggeeft. CMS-updates zitten er dus altijd in.

## Deployen (eenmalig, ±5 min)

1. Zet deze map in een GitHub-repo (of gebruik `vercel` CLI).
2. Ga naar vercel.com → "Add New Project" → importeer de repo → Deploy.
   Geen environment variables nodig. Gratis Hobby-plan volstaat.
3. Je endpoint is daarna bv.:
   `https://framer-cv-export.vercel.app/api/cv?slug=kennedy-talbot`

## Gebruik

| URL | Resultaat |
|---|---|
| `/api/cv?slug=kennedy-talbot` | PDF — pixel-perfect print van de `/pdf`-pagina |
| `/api/cv?slug=kennedy-talbot&format=docx` | Bewerkbaar Word-document |

De `slug` wordt gevalideerd (alleen `a-z`, `0-9`, `-`) en altijd geplakt achter
`https://www.33chambers.co.uk/people/<slug>/pdf` — niemand kan het endpoint dus
misbruiken om willekeurige sites te printen.

## Knop in Framer

**Optie A — statische link per CMS-item (simpelst):**
Voeg in je CMS-collection een veld toe (of gebruik de bestaande slug) en geef de
"Download CV"-knop als link:
`https://<jouw-project>.vercel.app/api/cv?slug=<slug van het item>`
In Framer kun je in een Link-veld CMS-variabelen gebruiken via "Add CMS field".

**Optie B — code component (pakt de slug automatisch uit de URL):**

```tsx
export default function DownloadCV() {
  const handleClick = () => {
    const slug = window.location.pathname.split("/").filter(Boolean)[1]; // /people/<slug>/...
    window.open(`https://<jouw-project>.vercel.app/api/cv?slug=${slug}`, "_blank");
  };
  return (
    <button onClick={handleClick} style={{ padding: "12px 24px", cursor: "pointer" }}>
      Download CV (PDF)
    </button>
  );
}
```

## Styling aanpassen

**PDF** → de PDF is letterlijk een print van je Framer `/pdf`-pagina, dus de
styling pas je gewoon in Framer aan. Daarbovenop:
- `PDF_OPTIONS` in `api/cv.js`: papierformaat en marges.
- `PRINT_CSS` in `api/cv.js`: extra CSS die alleen bij het printen geldt
  (nav/footer verbergen, paginabreuk-regels zoals `break-after: avoid` op koppen).

**Word** → pas het `DOCX_THEME`-blok bovenin `api/cv.js` aan:
lettertype, groottes (in halve punten: 22 = 11pt), kleuren (hex zonder #),
regelafstand. Voor meer (tabellen, logo's in de header, voettekst met
paginanummers) breid je `generateDocx()` uit met docx-js elementen.

## Lokaal testen

```bash
npm install
npx vercel dev
# → http://localhost:3000/api/cv?slug=kennedy-talbot&format=docx
```

(PDF lokaal testen vereist een lokale Chrome; op Vercel zelf werkt het
out-of-the-box via @sparticuz/chromium.)
