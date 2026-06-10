// Nachtelijke cache-warmer: genereert alle CV's alvast (5 tegelijk).
module.exports = async (req, res) => {
  try {
    const sm = await fetch("https://www.33chambers.co.uk/sitemap.xml").then((r) => r.text());
    const slugs = [...new Set([...sm.matchAll(/\/people\/([a-z0-9-]+)/g)].map((m) => m[1]))];
    const base = `https://${req.headers.host}/api/cv`;

    const results = [];
    const CONCURRENCY = 5;
    for (let i = 0; i < slugs.length; i += CONCURRENCY) {
      const batch = slugs.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(
        batch.map((slug) =>
          fetch(`${base}?slug=${slug}`)
            .then((r) => `${slug}: ${r.status}`)
            .catch(() => `${slug}: error`)
        )
      );
      results.push(...settled);
    }
    return res.json({ count: results.length, warmed: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
