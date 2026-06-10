// Wordt 's nachts door Vercel Cron aangeroepen: genereert alle CV's alvast,
// zodat elke download overdag uit de (stale-while-revalidate) cache komt.
module.exports = async (req, res) => {
  try {
    const sm = await fetch("https://www.33chambers.co.uk/sitemap.xml").then((r) => r.text());
    const slugs = [...sm.matchAll(/\/people\/([a-z0-9-]+)</g)].map((m) => m[1]);
    const base = `https://${req.headers.host}/api/cv`;
    const results = [];
    for (const slug of [...new Set(slugs)]) {
      const r = await fetch(`${base}?slug=${slug}`).catch(() => null);
      results.push(`${slug}: ${r ? r.status : "error"}`);
    }
    return res.json({ warmed: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
