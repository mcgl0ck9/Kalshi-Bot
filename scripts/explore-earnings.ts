import { kalshiFetchJson } from '../src/utils/kalshi-auth.js';

async function explore() {
  // Find all earnings mention series
  const data = await kalshiFetchJson<{ series?: Array<{ ticker: string; title: string }> }>('/trade-api/v2/series?limit=500');
  const allSeries = data?.series ?? [];

  const earningsSeries = allSeries.filter(s => {
    const ticker = (s.ticker ?? '').toUpperCase();
    return ticker.includes('EARNINGSMENT') || ticker.includes('EARNINGS');
  });

  console.log(`Found ${earningsSeries.length} earnings series:\n`);

  // Check each for active markets and extract keywords
  const activeSeriesList: Array<{series: typeof earningsSeries[0], activeCount: number, keywords: string[], markets: Array<{ticker: string, subtitle: string, price: number}>}> = [];

  for (const series of earningsSeries) {
    const mkts = await kalshiFetchJson<{ markets?: unknown[] }>(
      `/trade-api/v2/markets?series_ticker=${series.ticker}&limit=50`
    );
    const markets = (mkts?.markets ?? []) as Array<Record<string, unknown>>;
    const active = markets.filter(m => m.status === 'active' || m.status === 'open');

    if (active.length === 0) continue;

    // Extract keywords from tickers
    const keywords = new Set<string>();
    const marketList: Array<{ticker: string, subtitle: string, price: number}> = [];

    for (const m of active) {
      const ticker = (m.ticker as string) ?? '';
      const subtitle = (m.subtitle as string) ?? '';
      const price = (m.yes_bid as number) ?? (m.last_price as number) ?? 0;

      // Pattern: KXEARNINGSMENTIONDAL-26JUN30-KEYWORD
      const match = ticker.match(/-([A-Z]+)$/i);
      if (match) {
        keywords.add(match[1].toUpperCase());
      }
      marketList.push({ ticker, subtitle, price });
    }

    activeSeriesList.push({
      series,
      activeCount: active.length,
      keywords: [...keywords],
      markets: marketList
    });
  }

  // Display results
  console.log(`\n\n========================================`);
  console.log(`SERIES WITH ACTIVE MARKETS: ${activeSeriesList.length}`);
  console.log(`========================================\n`);

  // Build keyword frequency map
  const allKeywords = new Map<string, number>();

  for (const item of activeSeriesList) {
    console.log(`\n📈 ${item.series.ticker} (${item.series.title})`);
    console.log(`   Active markets: ${item.activeCount}`);
    console.log(`   Keywords: ${item.keywords.join(', ')}`);

    for (const kw of item.keywords) {
      allKeywords.set(kw, (allKeywords.get(kw) || 0) + 1);
    }

    // Show price extremes
    const sorted = item.markets.sort((a, b) => b.price - a.price);
    const high = sorted[0];
    const low = sorted[sorted.length - 1];
    console.log(`   Highest: ${high.ticker} @ ${high.price}¢`);
    console.log(`   Lowest:  ${low.ticker} @ ${low.price}¢`);
  }

  // Show most common keywords
  console.log(`\n\n========================================`);
  console.log(`KEYWORD FREQUENCY (across all series)`);
  console.log(`========================================\n`);

  const sortedKeywords = [...allKeywords.entries()].sort((a, b) => b[1] - a[1]);
  for (const [kw, count] of sortedKeywords.slice(0, 30)) {
    console.log(`  ${kw}: ${count} series`);
  }
}

explore().catch(console.error);
