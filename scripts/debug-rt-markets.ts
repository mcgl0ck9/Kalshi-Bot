/**
 * Debug script to see what RT markets exist and their statuses
 */

import { kalshiFetchJson } from '../src/utils/kalshi-auth.js';

async function debugRTMarkets() {
  console.log('Fetching series...');

  const seriesData = await kalshiFetchJson<{ series?: Array<{ ticker: string; title: string }> }>(
    '/trade-api/v2/series?limit=500'
  );

  if (!seriesData?.series) {
    console.log('No series data');
    return;
  }

  const rtSeries = seriesData.series.filter(s =>
    s.ticker.includes('RT') || s.title.toLowerCase().includes('rotten')
  );

  console.log(`\nFound ${rtSeries.length} RT series`);

  // Check first 5 series
  for (const series of rtSeries.slice(0, 5)) {
    console.log(`\n=== ${series.ticker}: ${series.title} ===`);

    const data = await kalshiFetchJson<{ markets?: unknown[] }>(
      `/trade-api/v2/markets?series_ticker=${series.ticker}&limit=10`
    );

    if (!data?.markets) {
      console.log('  No markets');
      continue;
    }

    for (const m of data.markets) {
      const market = m as Record<string, unknown>;
      console.log(`  ${market.ticker}: status="${market.status}", price=${market.yes_bid || market.last_price}c`);
    }
  }
}

debugRTMarkets().catch(console.error);
