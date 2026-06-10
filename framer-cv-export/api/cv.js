/**
 * GET /api/cv?slug=kennedy-talbot              → PDF (pixel-perfect print van de /pdf-pagina)
 * GET /api/cv?slug=kennedy-talbot&format=docx  → bewerkbaar Word-document
 *
 * De content wordt op het moment van de klik live van de Framer-pagina gehaald,
 * dus CMS-updates zitten er altijd automatisch in.
 */

const cheerio = require("cheerio");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat,
} = require("docx");

// ── Configuratie ────────────────────────────────────────────────────────────
const SITE = "https://www.33chambers.co.uk";
const PAGE = (slug) => `${SITE}/people/${slug}/pdf`; // jullie print-vriendelijke pagina
const SLUG_RE = /^[a-z0-9-]{1,80}$/; // beveiliging: alleen geldige slugs, geen vrije URL's

// ── PDF-stijl (pixel-perfect route) ─────────────────────────────────────────
// De opmaak van de PDF = de opmaak van je Framer /pdf-pagina zelf.
// Hier stuur je alleen het "papier" aan; extra print-CSS kun je injecteren via PRINT_CSS.
const PDF_OPTIONS = {
  format: "A4",
  printBackground: true,
  margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
};
const PRINT_CSS = `
  /* Wordt vlak voor het printen in de pagina geïnjecteerd.
     Handig om webdingen te verbergen of regels af te dwingen: */
  nav, footer, [data-framer-name="Nav"], [data-framer-name="Footer"] { display: none !important; }
  a { text-decoration: none; color: inherit; }
  h2, h3 { break-after: avoid; }          /* geen kop onderaan een pagina */
  blockquote, li { break-inside: avoid; } /* quotes/items niet doormidden */
`;

// ── DOCX-stijl (bewerkbare route) ───────────────────────────────────────────
// Pas hier font, groottes (halve punten: 22 = 11pt), kleuren (hex) en witruimte aan.
const DOCX_THEME = {
  font: "Georgia",
  bodySize: 21,          // 10,5pt
  lineSpacing: 300,      // 1,25 regelafstand
  headingColor: "1F2A44",
  accentColor: "C9A45C",
  h1: 40, h2: 27, h3: 23, // 20pt / 13,5pt / 11,5pt
};

// ── Handler ─────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  try {
    const { slug, format = "pdf" } = req.query;
    if (!slug || !SLUG_RE.test(slug)) {
      return res.status(400).json({ error: "Ongeldige of ontbrekende ?slug=" });
    }
    const url = PAGE(slug);
    const filename = `${slug}-33-chambers`;

    if (format === "docx") {
      const buffer = await generateDocx(url);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.docx"`);
      return res.send(buffer);
    }

    const buffer = await generatePdf(url);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};

// ── PDF: headless Chrome print de echte pagina ──────────────────────────────
async function generatePdf(url) {
  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");
const browser = await puppeteer.launch({
  args: chromium.args,
  defaultViewport: chromium.defaultViewport,
  executablePath: await chromium.executablePath(),
  headless: chromium.headless,
});
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
    await page.addStyleTag({ content: PRINT_CSS });
    await page.emulateMediaType("print");
    return await page.pdf(PDF_OPTIONS);
  } finally {
    await browser.close();
  }
}

// ── DOCX: HTML uitlezen en als bewerkbaar Word-document opbouwen ────────────
async function generateDocx(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; cv-export/1.0)" } });
  if (!r.ok) throw new Error(`Pagina ophalen mislukt: ${r.status}`);
  const $ = cheerio.load(await r.text());
  $("script, style, noscript, nav, footer").remove();

  const HEADINGS = { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3,
                     h4: HeadingLevel.HEADING_4, h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6 };
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  const seen = new Set(); // Framer rendert desktop/tablet/mobiel-varianten → ontdubbelen
  const blocks = [];

  $("body").find("h1, h2, h3, h4, h5, h6, p, li, blockquote").each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if ($(el).parents("li").length && tag !== "li") return;
    const text = clean($(el).text());
    if (!text || text.length < 2) return;
    const key = `${tag}::${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    blocks.push({ tag, text });
  });
  if (!blocks.length) throw new Error("Geen content gevonden op de pagina.");

  const T = DOCX_THEME;
  const children = blocks.map(({ tag, text }) => {
    if (HEADINGS[tag]) return new Paragraph({ heading: HEADINGS[tag], children: [new TextRun(text)] });
    if (tag === "li") return new Paragraph({ numbering: { reference: "bullets", level: 0 },
      spacing: { after: 80 }, children: [new TextRun(text)] });
    if (tag === "blockquote") return new Paragraph({ indent: { left: 360 }, spacing: { after: 160 },
      children: [new TextRun({ text, italics: true })] });
    return new Paragraph({ spacing: { after: 160 }, children: [new TextRun(text)] });
  });

  const doc = new Document({
    styles: {
      default: { document: { run: { font: T.font, size: T.bodySize },
        paragraph: { spacing: { line: T.lineSpacing } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: T.h1, bold: true, font: T.font, color: T.headingColor },
          paragraph: { spacing: { before: 0, after: 160 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: T.h2, bold: true, font: T.font, color: T.headingColor },
          paragraph: { spacing: { before: 220, after: 140 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: T.h3, bold: true, font: T.font, color: T.headingColor },
          paragraph: { spacing: { before: 180, after: 120 }, outlineLevel: 2 } },
      ],
    },
    numbering: { config: [{ reference: "bullets",
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1300, right: 1440, bottom: 1300, left: 1440 } } },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}
