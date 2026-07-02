/**
 * GET /api/cv?slug=kennedy-talbot  →  PDF-download van de /pdf-pagina
 */

const SITE = "https://www.33chambers.co.uk";
const SLUG_RE = /^[\p{L}\p{N}()'-]{1,80}$/u;

const PDF_OPTIONS = {
  format: "A4",
  printBackground: true,
  scale: 0.65,
  margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
};

module.exports = async (req, res) => {
  try {
    const slug = decodeURIComponent(req.query.slug || "");
    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({ error: "Ongeldige of ontbrekende ?slug=" });
    }

    const pdf = await generatePdf(`${SITE}/people/${encodeURIComponent(slug)}/pdf`);

    const safeName = slug.normalize("NFD").replace(/[^\w-]/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-33-chambers.pdf"`);
    // 1 dag cache; daarna mag oude versie geserveerd worden terwijl een nieuwe wordt gemaakt
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.send(Buffer.from(pdf));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "PDF genereren mislukt, probeer opnieuw." });
  }
};

async function generatePdf(url) {
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = (await import("puppeteer-core")).default;

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1440, height: 2000 },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // wacht écht op fonts en afbeeldingen (geen gok van 400ms meer)
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() =>
      Promise.all(
        [...document.images]
          .filter((img) => !img.complete)
          .map((img) => new Promise((r) => { img.onload = img.onerror = r; }))
      )
    );

    await page.emulateMediaType("print");
    return await page.pdf(PDF_OPTIONS);
  } finally {
    await browser.close();
  }
}
