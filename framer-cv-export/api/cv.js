/**
 * GET /api/cv?slug=kennedy-talbot              → PDF (pixel-perfect print van de /pdf-pagina)
 * GET /api/cv?slug=kennedy-talbot&format=docx  → bewerkbaar, gestyled Word-document
 *
 * Vereist in package.json:
 *   "engines": { "node": "22.x" }
 *   "@sparticuz/chromium": "^149.0.0", "puppeteer-core": "^25.1.0",
 *   "cheerio": "^1.0.0", "docx": "^9.0.0"
 */

const cheerio = require("cheerio");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat, BorderStyle,
} = require("docx");

// ── Configuratie ────────────────────────────────────────────────────────────
const SITE = "https://www.33chambers.co.uk";
const PAGE = (slug) => `${SITE}/people/${slug}/pdf`;
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

// ── PDF-stijl ───────────────────────────────────────────────────────────────
const PDF_OPTIONS = {
  format: "A4",
  printBackground: true,
  margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
};
const PRINT_CSS = `
  nav, footer, [data-framer-name="Nav"], [data-framer-name="Footer"] { display: none !important; }
  a { text-decoration: none; color: inherit; }
  h2, h3 { break-after: avoid; }
  blockquote, li { break-inside: avoid; }
`;

// ── DOCX-stijl: pas hier de huisstijl aan ───────────────────────────────────
const DOCX_THEME = {
  font: "Georgia",       // lettertype voor het hele document
  bodySize: 21,          // 10,5pt (halve punten: 22 = 11pt)
  lineSpacing: 300,      // 1,25 regelafstand
  headingColor: "1F2A44",// navy
  accentColor: "C9A45C", // goud (lijnen, groepslabels)
  greyColor: "666666",   // bronvermeldingen
  h1: 40, h2: 27, h3: 23,
};

// UI-teksten van de site die niet in het document horen
const SKIP_EXACT = new Set([
  "view cases", "quotes", "contact", "call", "silk", "new york",
  "other language(s)", "download cv",
]);

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
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; cv-export/1.0)" } });
      if (!r.ok) throw new Error(`Pagina ophalen mislukt: ${r.status}`);
      const buffer = await generateDocx(await r.text());
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

// ── DOCX: HTML uitlezen en met structuurherkenning opmaken ──────────────────
const clean = (s) => s.replace(/\s+/g, " ").trim();
const isQuote = (t) => /^[\u201C"']/.test(t) || /^\.\./.test(t);
const isSource = (t) => /^(chambers (and|&) partners|legal 500|who'?s who legal|the legal 500)/i.test(t);
const isCaseName = (t) =>
  t.length < 160 && (/\[\d{4}\]/.test(t) || /\sv\.?\s/.test(t) || /\((SC|Supreme Court|Court of Appeal)\)/i.test(t));

async function generateDocx(html) {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer").remove();

  const HEADING_LVL = { h1: 1, h2: 2, h3: 3, h4: 3, h5: 3, h6: 3 };
  const seen = new Set();
  const blocks = [];

  $("body").find("h1, h2, h3, h4, h5, h6, p, li, blockquote").each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if ($(el).parents("li").length && tag !== "li") return;
    const text = clean($(el).text());
    if (!text || text.length < 2) return;
    if (SKIP_EXACT.has(text.toLowerCase())) return;   // knop-/labelteksten overslaan
    if (tag === "p" && /^\d{4}$/.test(text)) return;  // losse jaartallen overslaan
    const key = `${tag}::${text}`;
    if (seen.has(key)) return;                        // Framer breakpoint-duplicaten
    seen.add(key);
    blocks.push({ tag, text });
  });
  if (!blocks.length) throw new Error("Geen content gevonden op de pagina.");

  const T = DOCX_THEME;
  const children = [];

  for (const { tag, text } of blocks) {
    if (HEADING_LVL[tag]) {
      const lvl = HEADING_LVL[tag];
      children.push(new Paragraph({
        heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][lvl - 1],
        alignment: lvl === 1 ? AlignmentType.CENTER : undefined,
        children: [new TextRun(text)],
      }));
      if (lvl === 1) children.push(new Paragraph({ // gouden lijn onder hoofdtitel
        spacing: { after: 240 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: T.accentColor, space: 4 } },
        children: [],
      }));
      continue;
    }
    if (tag === "li") {
      children.push(new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { after: 80 },
        children: [new TextRun(text)],
      }));
      continue;
    }
    if (isQuote(text)) {
      children.push(new Paragraph({
        indent: { left: 360 },
        spacing: { after: 30 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: T.accentColor, space: 8 } },
        children: [new TextRun({ text, italics: true })],
      }));
      continue;
    }
    if (isSource(text)) {
      children.push(new Paragraph({
        indent: { left: 360 },
        spacing: { after: 180 },
        children: [new TextRun({ text, color: T.greyColor, size: T.bodySize - 3 })],
      }));
      continue;
    }
    if (isCaseName(text)) {
      children.push(new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [new TextRun({ text, bold: true })],
      }));
      continue;
    }
    if (/^(white collar|commercial dispute|international & offshore)/i.test(text) && text.length < 60) {
      children.push(new Paragraph({
        spacing: { before: 160, after: 20 },
        children: [new TextRun({ text: text.toUpperCase(), bold: true, color: T.accentColor, size: 16 })],
      }));
      continue;
    }
    children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun(text)] }));
  }

  const doc = new Document({
    styles: {
      default: { document: { run: { font: T.font, size: T.bodySize },
        paragraph: { spacing: { line: T.lineSpacing } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: T.h1, bold: true, font: T.font, color: T.headingColor },
          paragraph: { spacing: { before: 0, after: 100 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: T.h2, bold: true, font: T.font, color: T.headingColor },
          paragraph: { spacing: { before: 240, after: 140 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: T.h3, bold: true, font: T.font, color: T.headingColor },
          paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
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
