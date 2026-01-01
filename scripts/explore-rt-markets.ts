import { kalshiFetchJson } from '../src/utils/kalshi-auth.js';

async function explore() {
  const data = await kalshiFetchJson<{ series?: Array<{ ticker: string; title: string }> }>('/trade-api/v2/series?limit=500');
  const allSeries = data?.series ?? [];

  const rtSeries = allSeries.filter(s =>
    s.ticker?.toUpperCase().includes('KXRT') ||
    (s.title?.toLowerCase().includes('rotten') && s.title?.toLowerCase().includes('tomatoes'))
  );

  console.log(`\n${'='.repeat(50)}`);
  console.log(`RT Market Series: ${rtSeries.length}`);
  console.log(`${'='.repeat(50)}\n`);

  // Collect all active markets
  const allActiveMarkets: Array<{series: string, title: string, ticker: string, price: number}> = [];

  // Check each for active markets
  for (const series of rtSeries.slice(0, 60)) {
    const mkts = await kalshiFetchJson<{ markets?: unknown[] }>(
      `/trade-api/v2/markets?series_ticker=${series.ticker}&limit=20`
    );
    const markets = (mkts?.markets ?? []) as Array<Record<string, unknown>>;
    const active = markets.filter(m => m.status === 'active' || m.status === 'open');

    if (active.length > 0) {
      for (const m of active) {
        const price = (m.yes_bid as number) ?? (m.last_price as number) ?? 0;
        allActiveMarkets.push({
          series: series.ticker,
          title: series.title,
          ticker: m.ticker as string,
          price,
        });
      }
    }
  }

  // Print summary
  console.log(`\nFound ${allActiveMarkets.length} active RT markets:\n`);

  // Group by movie
  const byMovie = new Map<string, typeof allActiveMarkets>();
  for (const m of allActiveMarkets) {
    const list = byMovie.get(m.title) ?? [];
    list.push(m);
    byMovie.set(m.title, list);
  }

  for (const [movie, markets] of byMovie) {
    console.log(`📽️ ${movie} (${markets.length} markets)`);
    for (const m of markets.slice(0, 3)) {
      // Extract threshold from ticker (e.g., KXRTPRIMATE-85 -> 85%)
      const threshMatch = m.ticker.match(/-(\d+)$/);
      const threshold = threshMatch ? `${threshMatch[1]}%` : '?';
      console.log(`   ${threshold} threshold @ ${m.price}¢`);
    }
    if (markets.length > 3) {
      console.log(`   ... and ${markets.length - 3} more`);
    }
  }
}

explore().catch(console.error);
