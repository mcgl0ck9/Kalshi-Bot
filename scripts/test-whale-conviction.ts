/**
 * Integration test for whale conviction detection
 */

import { findWhaleConvictionSignals, formatWhaleConvictionReport } from '../src/fetchers/polymarket-onchain.js';

async function main() {
  console.log('🐋 Testing Whale Conviction Detection\n');
  console.log('This tests the full pipeline:');
  console.log('1. Fetch active markets from Gamma API');
  console.log('2. For each market, get YES/NO token positions from PnL subgraph');
  console.log('3. Identify whale positions (>$10K)');
  console.log('4. Calculate conviction and find signals');
  console.log('5. Get order book depth from CLOB API\n');

  console.log('='.repeat(60));
  console.log('Starting whale conviction scan...');
  console.log('='.repeat(60));

  const startTime = Date.now();

  try {
    // Run with lower thresholds for testing
    const signals = await findWhaleConvictionSignals(
      0.5,   // 50% conviction threshold (lower for testing)
      5000   // $5K liquidity minimum
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n✅ Scan completed in ${elapsed}s`);
    console.log(`   Found ${signals.length} whale conviction signals\n`);

    if (signals.length > 0) {
      console.log('='.repeat(60));
      console.log('TOP SIGNALS');
      console.log('='.repeat(60));

      for (const signal of signals.slice(0, 10)) {
        const strengthIcon = signal.signalStrength === 'strong' ? '🔴' :
                             signal.signalStrength === 'moderate' ? '🟡' : '🟢';
        const dirIcon = signal.convictionDirection === 'YES' ? '📈' : '📉';

        console.log(`\n${strengthIcon}${dirIcon} ${signal.marketTitle.slice(0, 60)}`);
        console.log(`   Market Price: ${(signal.polymarketPrice * 100).toFixed(1)}%`);
        console.log(`   Whale Implied: ${(signal.whaleImpliedPrice * 100).toFixed(1)}%`);
        console.log(`   Conviction: ${(signal.convictionStrength * 100).toFixed(0)}% ${signal.convictionDirection}`);
        console.log(`   Signal Strength: ${signal.signalStrength}`);
        console.log(`   Depth Imbalance: ${(signal.depthImbalance * 100).toFixed(0)}%`);

        if (signal.topWhalePositions.length > 0) {
          console.log(`   Top Whales (${signal.topWhalePositions.length}):`);
          for (const whale of signal.topWhalePositions.slice(0, 3)) {
            console.log(`     - ${whale.wallet.slice(0, 10)}...: $${whale.size.toFixed(0)} @ ${(whale.avgPrice * 100).toFixed(0)}%`);
          }
        }
      }

      console.log('\n' + '='.repeat(60));
      console.log('DISCORD FORMAT');
      console.log('='.repeat(60));
      console.log(formatWhaleConvictionReport(signals));
    } else {
      console.log('No signals found. This could mean:');
      console.log('1. No markets have strong whale conviction (>50% one-sided)');
      console.log('2. Whale positions align with market prices (no edge)');
      console.log('3. Not enough whale activity in liquid markets');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test Complete');
  console.log('='.repeat(60));
}

main().catch(console.error);
