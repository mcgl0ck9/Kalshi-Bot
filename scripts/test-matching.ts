import { calculateTitleSimilarity } from '../src/analysis/cross-platform.js';

// Final validation test cases
const testCases: [string, string, 'match' | 'no'][] = [
  // Should match (>50%)
  ['Bitcoin above $100K', 'Will Bitcoin reach $100,000?', 'match'],
  ['Chiefs win Super Bowl', 'Kansas City Chiefs to win Super Bowl', 'match'],
  ['Lakers win NBA Championship', 'Will the Lakers win the 2025 NBA Finals?', 'match'],
  ['Trump wins 2024 election', 'Will Donald Trump win the 2024 presidential election?', 'match'],
  ['Chiefs vs Eagles Super Bowl', 'Kansas City Chiefs to beat Philadelphia Eagles', 'match'],
  ['Lakers vs Celtics NBA Finals', 'Los Angeles Lakers to win vs Boston Celtics', 'match'],
  ['Yankees vs Dodgers World Series', 'New York Yankees to beat LA Dodgers', 'match'],

  // Should NOT match (<30%)
  ['When will a supervolcano next erupt?', 'Will the Democrats win the Nevada governor race?', 'no'],
  ['Who will the next Pope be?', 'Will the Republicans win the Senate race?', 'no'],
  ['Will Elon Musk visit Mars?', 'Will Kim Kardashian pass the bar exam?', 'no'],
  ['Will humans colonize Mars?', 'Brazil unemployment below 6.3%?', 'no'],
  ['Will 2 degrees Celsius warming happen?', 'Will Antoine sign with a new club?', 'no'],
];

console.log('=== MATCHING ALGORITHM VALIDATION ===\n');

let passed = 0;
let failed = 0;

for (const [t1, t2, expected] of testCases) {
  const score = calculateTitleSimilarity(t1, t2);
  const actual = score >= 0.5 ? 'match' : 'no';
  const status = actual === expected ? 'PASS' : 'FAIL';

  if (actual === expected) passed++;
  else failed++;

  console.log(`[${status}] ${(score * 100).toFixed(0)}% - Expected: ${expected}`);
  console.log(`  "${t1.slice(0, 50)}"`);
  console.log(`  "${t2.slice(0, 50)}"\n`);
}

console.log(`\n=== RESULTS: ${passed}/${passed + failed} tests passed ===`);
if (failed > 0) {
  console.log('Some tests failed!');
  process.exit(1);
} else {
  console.log('All tests passed!');
}
