/**
 * Find active RT markets
 */

import { kalshiFetchJson } from '../src/utils/kalshi-auth.js';

async function findActiveRT() {
  const data = await kalshiFetchJson<{ series?: Array<{ ticker: string; title: string }> }>(
    '/trade-api/v2/series?limit=500'
  );

  if (!data || !data.series) {
    console.log('No series data');
    return;
  }

  const rtSeries = data.series.filter(s =>
    s.ticker.includes('RT') || s.title.toLowerCase().includes('rotten')
  );

  console.log(`Total RT series: ${rtSeries.length}`);

  // Check for active markets
  console.log('\nChecking for active RT markets...');
  let activeCount = 0;

  for (const s of rtSeries.slice(0, 30)) {
    const markets = await kalshiFetchJson<{ markets?: unknown[] }>(
      `/trade-api/v2/markets?series_ticker=${s.ticker}&status=active&limit=5`
    );

    if (markets && markets.markets && markets.markets.length > 0) {
      console.log(`  ACTIVE: ${s.ticker} - ${markets.markets.length} markets`);
      activeCount += markets.markets.length;

      // Show first market
      const first = markets.markets[0] as Record<string, unknown>;
      console.log(`    First: ${first.ticker} - ${first.title} @ ${first.yes_bid || first.last_price}c`);
    }
  }

  console.log(`\nTotal active RT markets found: ${activeCount}`);
}

findActiveRT().catch(console.error);
