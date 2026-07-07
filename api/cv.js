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
  footerTemplate: `
    <div style="width:100%; text-align:center; font-size:8px; color:#999; font-family:Arial, sans-serif;">
      Page <span class="pageNumber"></span> of <span class="totalPages"></span>
    </div>`,
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
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeName}-33-chambers.pdf"`
    );
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=600, stale-while-revalidate=604800"
    );

    return res.status(200).send(pdf);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "PDF kon niet worden gegenereerd",
    });
  }
};
