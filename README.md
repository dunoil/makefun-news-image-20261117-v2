# The World in One Image — Tuesday 17 November 2026 (v2)

Second entry for the make.fun bounty **news-image-20261117** ("Sum up 17
November's world news in one image") — a richer broadsheet front page of
the same verified day's news as v1, rebuilt for density and legibility.

`main.ts` is a self-contained Node program (standard library only, no
network) that **draws the whole page in code** on a 2x supersampled
canvas (anti-aliased on downsampling): gradient skies and seas with
ordered dithering, drawn scenes for every story, a dot-matrix world map,
a 5x7 bitmap typeface, and its own PNG encoder (zlib + CRC32). It writes
a deterministic 1024x1024 PNG (109,383 bytes, under the 1 MiB gate) to
`/output/entry.png`:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`entry.png` in this repository is a preview of exactly the bytes the
program writes (three runs produce identical SHA-256).

## What the image shows

- **Masthead + date band:** "THE WORLD IN ONE IMAGE" over a full-width
  red band naming the day in the largest type on the page:
  **TUESDAY 17 NOVEMBER 2026**.
- **Lead story (Diplomacy):** Xi, Trump & Putin to meet in the first
  trilateral summit — China confirmed the three leaders meet Thursday
  19 November in Shenzhen, on the sidelines of the APEC summit. The
  drawn scene shows the three national flags over the Shenzhen skyline
  and the leaders at one table; an "at a glance" strip gives the date,
  place and forum.
- **The day on the map:** a dot-matrix world map with the day's nine
  places numbered — Shenzhen, Hormuz, Kyiv, Antalya, Gaza, the US,
  Paris, Japan and Oman.
- **Numbers band:** 264 days of the US–Iran war • 5,412 US measles
  cases • $120bn a year of adaptation finance by 2035 • 19 Nov summit
  day • 1-wicket margin in the U19 final.
- **Six story panels, each with its own drawn scene:**
  1. **War at sea — Tankers burn in Hormuz** (day 264 of the US–Iran
     war): US jets struck an IRGC missile site on Qeshm Island; tankers
     hit mines in the strait; a third US carrier arrived in the region.
  2. **Ukraine — Kyiv pounded, bridge shut:** a major Russian ballistic
     missile attack cut heat and water in Kyiv; the Crimean Bridge was
     closed after a Ukrainian strike.
  3. **Climate — COP31 draft: phase out fossil fuels:** the Antalya
     draft deal called for accelerated fossil-fuel phase-out and
     tripling adaptation finance to at least $120bn a year by 2035.
  4. **Gaza aid appeal — Open Gaza crossings now:** the UK, Australia,
     Canada and Italy jointly urged Israel to open Gaza crossings,
     calling the aid crisis catastrophic.
  5. **Health — US loses measles-free status:** PAHO announced the
     United States has lost its measles elimination status after
     26 years; the CDC counted 5,412 cases in 2026.
  6. **Tech + markets — AI chip curbs hit China:** the US Commerce
     Department tightened AI chip export rules to close a
     foreign-purchase loophole; Nvidia reported earnings after the bell.
- **Ticker:** Gérard Depardieu pleads guilty to sexual assault charges
  in Paris and drops his appeal • Japan scrambles jets after Russian
  aircraft entered its airspace • India edge Pakistan by one wicket in
  a last-ball thriller to win the Under-19 Asia Cup final in Oman.

## Sources (reporting of 17 November 2026)

- Daily Buzz, 17 November 2026 (AFP / Dawn reporting on the trilateral
  summit, the Kyiv attack and the chip rules):
  https://www.linkedin.com/pulse/daily-buzz-17-november-2026-china-biz-buzz-v0zcc
- World News Tonight, full episode Tuesday November 17, 2026 (Hormuz
  strikes, the summit, measles status):
  https://podcastrex.com/shows/world-news-tonight-with-david-muir/full-episode-tuesday-november-17-2026
- Atlantic Digest, "US-Iran war day 264" (Qeshm strike, tankers, drones):
  https://atlanticdigest.com/politics/us-iran-war-day-264-iran-sends-drones-at-us-forces-in-bahrain-and-kuwait-after-american-strike-on-qeshm-island/
- Ummah Atlas explainer (UKMTO tanker report, third carrier):
  https://ummahatlas.com/blog/tanker-hit-strait-of-hormuz-third-us-carrier-november-17-2026-explained/
- Asas Press, World News Digest: Top Stories of November 17, 2026 (Gaza
  aid call, Depardieu, Japan airspace, Crimean Bridge):
  https://asaspress.com/en/news/world-news-digest-top-stories-of-november-17-2026
- The Business Standard (Reuters/DW reporting), COP31 draft:
  https://www.tbsnews.net/economy/cop31-draft-calls-fossil-fuel-phaseout-least-120bn-adaptation-finance-1604866
- CNN, "The United States' measles elimination status is officially gone"
  (PAHO announcement, CDC case count):
  https://www.cnn.com/2026/11/17/health/measles-vaccine-booster?cid=external-feeds_iluminar_meta
- Healthline, "U.S. Loses Measles Elimination Status After 26 Years":
  https://www.healthline.com/health-news/u-s-loses-measles-elimination-status-after-26-years
- Investopedia, "5 Things Investors Need to Know About Tuesday's Markets"
  (Nvidia earnings, chip stocks, export rules):
  https://www.investopedia.com/5-things-to-know-stock-market-november-17-2026-12260055
- NPR News Now, 5pm ET November 17 (UK sanctions over West Bank/Gaza):
  https://podcastrex.com/shows/npr-news-now/5pm-et-november-17-the-latest-headlines-from-npr

All artwork is original and drawn in code — no photographs or third-party
artwork are used. License: MIT (see `LICENSE`).
