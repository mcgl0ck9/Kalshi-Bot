/**
 * Backtest script for Measles Edge Detector
 *
 * Validates that the CDC data and probability calculations are producing
 * sensible edge signals.
 */

import { detectMeaslesEdges, formatMeaslesEdge } from '../src/edge/measles-edge.js';
import { fetchMeaslesCases, calculateExceedanceProbability } from '../src/fetchers/cdc-measles.js';

async function backtest() {
  console.log('='.repeat(70));
  console.log('MEASLES EDGE DETECTOR BACKTEST');
  console.log('='.repeat(70));
  console.log();

  // 1. Fetch and display CDC data
  console.log('1. FETCHING CDC MEASLES DATA');
  console.log('-'.repeat(40));
  const cdcData = await fetchMeaslesCases();
  if (!cdcData) {
    console.log('ERROR: Could not fetch CDC data');
    return;
  }

  console.log(`Year: ${cdcData.year}`);
  console.log(`Cases YTD: ${cdcData.casesYTD}`);
  console.log(`Week Number: ${cdcData.weekNumber}`);
  console.log(`Projected Year-End: ${cdcData.projectedYearEnd}`);
  console.log(`Projection Method: ${cdcData.projectionMethod}`);
  console.log(`Projection Confidence: ${(cdcData.projectionConfidence * 100).toFixed(0)}%`);
  console.log(`Historical Average (5yr): ${cdcData.historicalAverage}`);
  console.log(`Last Year Total: ${cdcData.lastYearTotal}`);
  console.log(`Source: ${cdcData.source}`);
  console.log();

  // 2. Test probability calculations for various thresholds
  console.log('2. PROBABILITY CALCULATIONS BY THRESHOLD');
  console.log('-'.repeat(40));
  const thresholds = [500, 750, 1000, 1250, 1500, 1750, 2000, 2500, 3000, 4000, 5000];

  console.log('Threshold | CDC Prob | Confidence');
  console.log('-'.repeat(40));
  for (const threshold of thresholds) {
    const result = calculateExceedanceProbability(cdcData, threshold);
    const exceeded = cdcData.casesYTD >= threshold ? ' (EXCEEDED)' : '';
    console.log(`${threshold.toString().padStart(7)} | ${(result.probability * 100).toFixed(1).padStart(6)}% | ${(result.confidence * 100).toFixed(0)}%${exceeded}`);
  }
  console.log();

  // 3. Detect edges in current markets
  console.log('3. CURRENT MEASLES MARKET EDGES');
  console.log('-'.repeat(40));
  const edges = await detectMeaslesEdges();

  if (edges.length === 0) {
    console.log('No active measles markets found or no edges detected');
  } else {
    console.log(`Found ${edges.length} edges:\n`);
    for (const edge of edges) {
      console.log(formatMeaslesEdge(edge));
      console.log();
      console.log(`  Threshold: ${edge.threshold}`);
      console.log(`  Kalshi Price: ${(edge.kalshiPrice * 100).toFixed(0)}¢`);
      console.log(`  CDC Implied: ${(edge.cdcImpliedPrice * 100).toFixed(0)}¢`);
      console.log(`  Edge: ${(edge.edge * 100).toFixed(1)}%`);
      console.log(`  Direction: ${edge.direction}`);
      console.log(`  Reasoning: ${edge.reasoning}`);
      console.log();
      console.log('-'.repeat(40));
    }
  }

  // 4. Validation checks
  console.log();
  console.log('4. EDGE VALIDATION');
  console.log('-'.repeat(40));

  let suspiciousEdges = 0;
  let validEdges = 0;

  for (const edge of edges) {
    const issues: string[] = [];

    // Check 1: If cases already exceeded threshold, edge should be very high
    if (cdcData.casesYTD >= edge.threshold) {
      if (edge.kalshiPrice < 0.95) {
        issues.push(`VALID: Threshold ${edge.threshold} already exceeded (${cdcData.casesYTD} cases), Kalshi at ${(edge.kalshiPrice * 100).toFixed(0)}c should be ~99c`);
      }
    }

    // Check 2: If edge is >50%, it might be suspicious
    if (Math.abs(edge.edge) > 0.50) {
      issues.push(`WARNING: Edge ${(edge.edge * 100).toFixed(1)}% is very high - verify market data`);
      suspiciousEdges++;
    }

    // Check 3: Direction should match the edge sign
    if ((edge.edge > 0 && edge.direction !== 'buy_yes') ||
        (edge.edge < 0 && edge.direction !== 'buy_no')) {
      issues.push(`ERROR: Direction mismatch - edge ${edge.edge > 0 ? 'positive' : 'negative'} but direction is ${edge.direction}`);
    }

    // Check 4: Validate price makes sense
    if (edge.kalshiPrice < 0.02 || edge.kalshiPrice > 0.98) {
      issues.push(`WARNING: Extreme price ${(edge.kalshiPrice * 100).toFixed(0)}c - likely illiquid`);
    }

    if (issues.length === 0) {
      console.log(`OK ${edge.ticker}: ${(edge.edge * 100).toFixed(1)}% edge looks valid`);
      validEdges++;
    } else {
      for (const issue of issues) {
        console.log(`${edge.ticker}: ${issue}`);
      }
    }
  }

  console.log();
  console.log('5. SUMMARY');
  console.log('-'.repeat(40));
  console.log(`Total edges found: ${edges.length}`);
  console.log(`Valid edges: ${validEdges}`);
  console.log(`Suspicious edges: ${suspiciousEdges}`);

  // Calculate accuracy of high-edge signals
  const highEdges = edges.filter(e => Math.abs(e.edge) > 0.15);
  console.log(`High-conviction edges (>15%): ${highEdges.length}`);

  if (edges.length > 0) {
    const avgEdge = edges.reduce((sum, e) => sum + Math.abs(e.edge), 0) / edges.length;
    console.log(`Average edge magnitude: ${(avgEdge * 100).toFixed(1)}%`);
  }
}

backtest().catch(console.error);
