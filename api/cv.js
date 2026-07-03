/**
 * GET /api/cv?slug=kennedy-talbot  →  PDF-download van de /pdf-pagina
 */

const SITE = "https://www.33chambers.co.uk";
const SLUG_RE = /^[\p{L}\p{N}()'-]{1,80}$/u;

const PDF_OPTIONS = {
  format: "A4",
  printBackground: true,
  scale: 0.65,
  margin: { top: "16mm", bottom: "16mm", left: "0mm", right: "0mm" },
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  try {
    const slug = decodeURIComponent(req.query.slug || "");
    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({ error: "Ongeldige of ontbrekende ?slug=" });
    }

    const pdf = await generatePdf(`${SITE}/people/${encodeURIComponent(slug)}/pdf`);

    const safeName = slug.normalize("NFD").replace(/[^\w-]/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-33-chambers.pdf"`);
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=604800");
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

    // wacht op fonts en afbeeldingen
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() =>
      Promise.all(
        [...document.images]
          .filter((img) => !img.complete)
          .map((img) => new Promise((r) => { img.onload = img.onerror = r; }))
      )
    );

    // 1) Lijm elke titelbalk fysiek vast aan de eerstvolgende sectie:
    //    samen in één wrapper, zodat ze nooit gescheiden kunnen worden.
    await page.evaluate(() => {
      const isSection = (el) =>
        el &&
        el.matches &&
        el.matches('[data-framer-name="ExpertiseItem"], [data-framer-name="PracticeSection"]');

      document.querySelectorAll("h1, h2, h3, h4, h5").forEach((h) => {
        h.style.breakInside = "avoid";

        // vind de balk: het compacte element rond de kop
        let bar = h.parentElement;
        if (!bar || bar.offsetHeight <= 0 || bar.offsetHeight >= 200) return;

        // vind wat er direct op de balk volgt
        const next = bar.nextElementSibling;

        if (next && isSection(next)) {
          // wikkel balk + sectie samen in een wrapper
          const wrap = document.createElement("div");
          bar.parentElement.insertBefore(wrap, bar);
          wrap.appendChild(bar);
          wrap.appendChild(next);

          // past het duo op één pagina? → als geheel bij elkaar houden.
          // Zo niet: laat het duo breken, maar bescherm de balk zelf.
          const MAX = 1600;
          if (wrap.offsetHeight < MAX) {
            wrap.style.breakInside = "avoid";
            wrap.style.pageBreakInside = "avoid";
          }
          bar.style.breakInside = "avoid";
          bar.style.pageBreakInside = "avoid";
        } else {
          // geen sectie direct erna (bv. de grote naamsbanner) → alleen de balk beschermen
          bar.style.breakInside = "avoid";
          bar.style.pageBreakInside = "avoid";
        }
      });
    });

    // 2) Secties die op één pagina passen: in hun geheel bij elkaar houden.
    //    Grotere secties breken gewoon netjes tussen de cases.
    await page.evaluate(() => {
      const MAX = 1600; // ≈ bruikbare paginahoogte in layout-pixels bij scale 0.65
      document
        .querySelectorAll('[data-framer-name="ExpertiseItem"], [data-framer-name="PracticeSection"]')
        .forEach((el) => {
          if (el.offsetHeight < MAX) {
            el.style.breakInside = "avoid";
            el.style.pageBreakInside = "avoid";
          }
        });
    });

    // 3) Verberg alleen écht lege secties: geen cases ÉN geen beschrijvende tekst
    await page.evaluate(() => {
      document
        .querySelectorAll('[data-framer-name="ExpertiseItem"], [data-framer-name="PracticeSection"]')
        .forEach((section) => {
          const hasCases = section.querySelector('[data-framer-name="CaseItem"]');
          if (hasCases) return; // cases aanwezig → altijd tonen

          const heading = section.querySelector("h1, h2, h3, h4, h5");
          const headingText = heading ? heading.textContent : "";
          const bodyText = (section.textContent || "")
            .replace(headingText, "")
            .replace(/\s+/g, " ")
            .trim();

          // minder dan 40 tekens échte inhoud → beschouwen als leeg
          if (bodyText.length < 40) section.remove();
        });
    });

    await page.emulateMediaType("print");
    return await page.pdf(PDF_OPTIONS);
  } finally {
    await browser.close();
  }
}
