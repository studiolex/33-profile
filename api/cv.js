/**
 * GET /api/cv?slug=kennedy-talbot  →  PDF-download van de /pdf-pagina
 */

const SITE = "https://www.33chambers.co.uk";
const SLUG_RE = /^[\p{L}\p{N}()'-]{1,80}$/u;

const PDF_OPTIONS = {
  format: "A4",
  printBackground: true,
  scale: 0.65,
  margin: { top: "12mm", bottom: "14mm", left: "0mm", right: "0mm" },
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: '<div style="width:100%;text-align:center;font-size:8px;color:#999;font-family:Arial,sans-serif;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
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

    // 1) Verberg alleen écht lege secties: geen cases ÉN geen beschrijvende tekst
    await page.evaluate(() => {
      document
        .querySelectorAll('[data-framer-name="ExpertiseItem"], [data-framer-name="PracticeSection"]')
        .forEach((section) => {
          const hasCases = section.querySelector('[data-framer-name="CaseItem"]');
          if (hasCases) return;

          const heading = section.querySelector("h1, h2, h3, h4, h5");
          const headingText = heading ? heading.textContent : "";
          const bodyText = (section.textContent || "")
            .replace(headingText, "")
            .replace(/\s+/g, " ")
            .trim();

          if (bodyText.length < 40) section.remove();
        });
    });

    // 2) De gouden naamsbanner ("Naam : Experience & Expertise") begint ALTIJD
    //    op een nieuwe pagina — consistente hoofdstuk-opmaak. Geneste duplicaten
    //    worden gefilterd zodat er nooit een dubbele breuk (= lege pagina) ontstaat.
    await page.evaluate(() => {
      const candidates = new Set();
      document.querySelectorAll("h1, h2, h3, h4, h5, div, p, span").forEach((el) => {
        if (
          el.children.length === 0 &&
          /experience\s*&\s*expertise/i.test(el.textContent || "")
        ) {
          let bar = el;
          while (
            bar.parentElement &&
            bar.parentElement.offsetHeight < 250 &&
            bar.parentElement !== document.body
          ) {
            bar = bar.parentElement;
          }
          candidates.add(bar);
        }
      });

      const all = [...candidates];
      const bars = all.filter(
        (b) => !all.some((o) => o !== b && o.contains(b))
      );

      bars.forEach((bar) => {
        bar.style.breakBefore = "page";
        bar.style.pageBreakBefore = "always";
      });
    });

    // 3) Grijze sectiekoppen: vastlijmen aan hun eigen sectie via een wrapper,
    //    zodat kop en content nooit gescheiden raken. Stapt over dunne
    //    tussenelementen (lijnen/spacers) heen.
    await page.evaluate(() => {
      const isSection = (el) =>
        el &&
        el.matches &&
        el.matches('[data-framer-name="ExpertiseItem"], [data-framer-name="PracticeSection"]');

      document.querySelectorAll("h1, h2, h3, h4, h5").forEach((h) => {
        if (/experience\s*&\s*expertise/i.test(h.textContent || "")) return;

        h.style.breakInside = "avoid";

        let bar = h.parentElement;
        if (!bar || bar.offsetHeight <= 0 || bar.offsetHeight >= 200) return;

        let next = bar.nextElementSibling;
        let hops = 0;
        while (next && !isSection(next) && hops < 2 && next.offsetHeight < 100) {
          next = next.nextElementSibling;
          hops++;
        }

        if (next && isSection(next)) {
          const between = [];
          let cursor = bar.nextElementSibling;
          while (cursor && cursor !== next) {
            between.push(cursor);
            cursor = cursor.nextElementSibling;
          }

          const wrap = document.createElement("div");
          bar.parentElement.insertBefore(wrap, bar);
          wrap.appendChild(bar);
          between.forEach((el) => wrap.appendChild(el));
          wrap.appendChild(next);

          const MAX = 1600;
          if (wrap.offsetHeight < MAX) {
            wrap.style.breakInside = "avoid";
            wrap.style.pageBreakInside = "avoid";
          }
          bar.style.breakInside = "avoid";
          bar.style.pageBreakInside = "avoid";
        } else {
          bar.style.breakInside = "avoid";
          bar.style.pageBreakInside = "avoid";
        }
      });
    });

    await page.emulateMediaType("print");
    return await page.pdf(PDF_OPTIONS);
  } finally {
    await browser.close();
  }
}
