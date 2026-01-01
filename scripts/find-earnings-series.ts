/**
 * Find all earnings mention series
 */

import { kalshiFetchJson } from '../src/utils/kalshi-auth.js';

async function findEarningsSeries() {
  const data = await kalshiFetchJson<{ series?: Array<{ ticker: string; title: string }> }>(
    '/trade-api/v2/series?limit=500'
  );

  if (!data || !data.series) {
    console.log('No series data');
    return;
  }

  const earningsSeries = data.series.filter(s =>
    s.ticker.toUpperCase().includes('KXEARNINGSMENTION')
  );

  console.log(`Found ${earningsSeries.length} earnings mention series:\n`);

  for (const s of earningsSeries) {
    // Extract company code
    const match = s.ticker.match(/KXEARNINGSMENTION([A-Z]+)/i);
    const companyCode = match ? match[1] : 'UNKNOWN';
    console.log(`${s.ticker.padEnd(35)} | ${companyCode.padEnd(6)} | ${s.title}`);
  }
}

findEarningsSeries().catch(console.error);
