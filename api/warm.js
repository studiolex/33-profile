// Nachtelijke cache-warmer: genereert alle CV's alvast (3 tegelijk).
module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.WARM_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const sm = await fetch("https://www.33chambers.co.uk/sitemap.xml").then((r) => r.text());
    const slugs = [...new Set(
      [...sm.matchAll(/\/people\/([^/<"]+?)\//g)]
        .map((m) => decodeURIComponent(m[1]))
        .filter((s) => !s.includes("pdf"))
    )];
    const base = `https://${req.headers.host}/api/cv`;
    const results = [];
    const CONCURRENCY = 3;
    for (let i = 0; i < slugs.length; i += CONCURRENCY) {
      const batch = slugs.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(
        batch.map((slug) =>
          fetch(`${base}?slug=${encodeURIComponent(slug)}`)
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
