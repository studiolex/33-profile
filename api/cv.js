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

// ── PDF-instellingen ────────────────────────────────────────────────────────
const PDF_OPTIONS = {
  format: "A4",
  printBackground: true,
  scale: 0.65, // layout op ~1220px (desktop-breakpoint), geschaald naar A4
  margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
};

// Geef in Framer deze namen aan de layers:
//  - "SectionHeader"   → de kop-balk van elke sectie
//  - "CaseItem"        → het herhalende blokje van één case (naam + omschrijving)
//  - "PracticeSection" → alléén de korte secties die altijd op 1 pagina passen
const PRINT_CSS = `
  nav, footer, [data-framer-name="Nav"], [data-framer-name="Footer"] { display: none !important; }
  a { text-decoration: none; color: inherit; }
  h1, h2, h3, h4 { break-after: avoid; }
  blockquote, li { break-inside: avoid; }
  [data-framer-name="SectionHeader"] { break-after: avoid; break-inside: avoid; }
  [data-framer-name="CaseItem"] { break-inside: avoid; }
  [data-framer-name="PracticeSection"] { break-inside: avoid; }
`;

// ── DOCX-stijl: pas hier de huisstijl van het Word-document aan ─────────────
const DOCX_THEME = {
  font: "Georgia", bodySize: 21, lineSpacing: 300,
  headingColor: "1F2A44", accentColor: "C9A45C", greyColor: "666666",
  h1: 40, h2: 27, h3: 23,
};

const SKIP = new Set(["view cases", "quotes", "contact", "other language(s)", "download cv"]);
const GROUP_LABELS = new Set([
  "white collar, crime & investigations",
  "commercial dispute resolution",
  "international & offshore",
]);
const META_LABELS = new Set(["call", "silk", "new york"]);

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
      res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
      return res.send(buffer);
    }

    const buffer = await generatePdf(url);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
    return res.send(Buffer.from(buffer));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};

// ── PDF: headless Chrome print de echte pagina ──────────────────────────────
async function generatePdf(url) {
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = (await import("puppeteer-core")).default ?? (await import("puppeteer-core"));

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 2000 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    // best effort: wacht kort op netwerkstilte, maar faal er nooit op
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 4000 }).catch(() => {});
    // korte adempauze zodat fonts en afbeeldingen gepaint zijn
    await new Promise((r) => setTimeout(r, 400));
await page.addStyleTag({ content: PRINT_CSS });
    await page.emulateMediaType("print");

    // Secties die op één A4 passen in hun geheel heel houden;
    // te grote secties blijven gewoon (netjes, tussen CaseItems) breken.
    await page.evaluate(() => {
      const MAX = 1600; // ≈ bruikbare paginahoogte in layout-pixels bij scale 0.65
      document.querySelectorAll('[data-framer-name="ExpertiseItem"]').forEach((el) => {
        if (el.offsetHeight < MAX) {
          el.style.breakInside = "avoid";
          el.style.pageBreakInside = "avoid";
        }
      });
    });

    return await page.pdf(PDF_OPTIONS);
  } finally {
    await browser.close();
  }
}

// ── DOCX: HTML uitlezen en met structuurherkenning opmaken ──────────────────
const clean = (s) => s.replace(/\s+/g, " ").trim();
const isJunk = (t) => SKIP.has(t.toLowerCase()) || /^\.{2}\//.test(t) || /^https?:\/\//.test(t);
const isQuote = (t) => /^[\u201C"']/.test(t) || /^\.\./.test(t);
const isSource = (t) => /^(chambers (and|&) partners|legal 500|who'?s who legal|the legal 500)/i.test(t);
const isCaseName = (t) =>
  t.length < 170 && (/\[\d{4}\]/.test(t) || /\sv\.?\s/.test(t) || /^Project\s/i.test(t) ||
  /\((SC|Supreme Court|Court of Appeal|QB|Comm|Admin)\)/i.test(t));

function extractBlocks($) {
  const blocks = [];
  $("body").find("h1, h2, h3, h4, h5, h6, p, li, blockquote").each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if ($(el).parents("li").length && tag !== "li") return;
    const text = clean($(el).text());
    if (!text || text.length < 2 || isJunk(text)) return;
    blocks.push({ tag, text, isHeading: /^h[1-6]$/.test(tag) });
  });
  return blocks;
}

async function generateDocx(html) {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer").remove();
  const blocks = extractBlocks($);
  if (!blocks.length) throw new Error("Geen content gevonden.");

  // De pagina kan de Experience-sectie 2x bevatten (kaal + volledig).
  // Splits op de heading en gebruik: kop/bio vóór de eerste, secties vanaf de laatste.
  const expIdx = blocks
    .map((b, i) => (b.isHeading && /experience\s*&\s*expertise/i.test(b.text) ? i : -1))
    .filter((i) => i >= 0);
  const headerBlocks = expIdx.length ? blocks.slice(0, expIdx[0]) : blocks;
  const bodyBlocks = expIdx.length ? blocks.slice(expIdx[expIdx.length - 1]) : [];

  const T = DOCX_THEME;
  const children = [];
  const goldRule = () => new Paragraph({
    spacing: { after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: T.accentColor, space: 4 } },
    children: [],
  });

  // ── Kop: naam, titel, meta-regel, expertise, bio ──
  const metaParts = [];
  let pendingLabel = null, prevText = null;

  function flushMeta() {
    if (!metaParts.length) return;
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [new TextRun({ text: metaParts.join("  \u00B7  "), color: T.greyColor })] }));
    children.push(goldRule());
    metaParts.length = 0;
  }

  for (const b of headerBlocks) {
    if (b.text === prevText) continue; // "Call Call" → 1x
    prevText = b.text;

    if (b.tag === "h1") {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun(b.text)] }));
      continue;
    }
    if (/^(KC|QC)$/i.test(b.text)) {
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
        children: [new TextRun({ text: b.text, bold: true, color: T.accentColor })] }));
      continue;
    }
    if (META_LABELS.has(b.text.toLowerCase())) { pendingLabel = b.text; continue; }
    if (/^\d{4}$/.test(b.text)) {
      if (pendingLabel) { metaParts.push(`${pendingLabel} ${b.text}`); pendingLabel = null; }
      continue;
    }
    if (b.isHeading) { // "Expertise"
      flushMeta();
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(b.text)] }));
      continue;
    }
    flushMeta();
    children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun(b.text)] }));
  }
  flushMeta();

  // ── Secties: groepslabels, koppen, zaken, quotes ──
  const seen = new Set();
  let first = true;
  for (const b of bodyBlocks) {
    if (b.isHeading && /experience\s*&\s*expertise/i.test(b.text)) {
      if (!first) continue;
      first = false;
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240 },
        children: [new TextRun("Experience & Expertise")] }));
      continue;
    }
    const key = `${b.tag}::${b.text}`;

    if (GROUP_LABELS.has(b.text.toLowerCase())) {
      children.push(new Paragraph({ spacing: { before: 200, after: 20 },
        children: [new TextRun({ text: b.text.toUpperCase(), bold: true, color: T.accentColor, size: 16 })] }));
      continue;
    }
    if (b.isHeading) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(b.text)] }));
      continue;
    }
    if (seen.has(key)) continue; // restant-duplicaten
    seen.add(key);

    if (b.tag === "li") {
      children.push(new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 },
        children: [new TextRun(b.text)] }));
      continue;
    }
    if (isQuote(b.text)) {
      children.push(new Paragraph({ indent: { left: 360 }, spacing: { after: 30 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: T.accentColor, space: 8 } },
        children: [new TextRun({ text: b.text, italics: true })] }));
      continue;
    }
    if (isSource(b.text)) {
      children.push(new Paragraph({ indent: { left: 360 }, spacing: { after: 180 },
        children: [new TextRun({ text: b.text, color: T.greyColor, size: T.bodySize - 3 })] }));
      continue;
    }
    if (isCaseName(b.text)) {
      children.push(new Paragraph({ spacing: { before: 100, after: 40 },
        children: [new TextRun({ text: b.text, bold: true })] }));
      continue;
    }
    children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun(b.text)] }));
  }

  const doc = new Document({
    styles: {
      default: { document: { run: { font: T.font, size: T.bodySize }, paragraph: { spacing: { line: T.lineSpacing } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: T.h1, bold: true, font: T.font, color: T.headingColor },
          paragraph: { spacing: { before: 0, after: 60 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: T.h2, bold: true, font: T.font, color: T.headingColor },
          paragraph: { spacing: { before: 240, after: 140 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: T.h3, bold: true, font: T.font, color: T.headingColor },
          paragraph: { spacing: { before: 60, after: 120 }, outlineLevel: 2 } },
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
