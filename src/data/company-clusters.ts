/**
 * Company Clusters for Sector-Wide Topic Inference
 *
 * Groups "like" companies so that when analysts ask one company about a topic,
 * we can infer increased probability that similar companies will be asked
 * about the same topic in their upcoming earnings.
 *
 * Example: If Kroger gets grilled about "delivery" in Q1, boost P(delivery)
 * for Albertsons, Walmart, Costco in their upcoming earnings.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface CompanyCluster {
  /** Unique identifier for the cluster */
  id: string;

  /** Human-readable name */
  name: string;

  /** Tickers of companies in this cluster */
  tickers: string[];

  /** Topics commonly shared across the cluster */
  sharedTopics: string[];

  /** Topic synonyms for better matching */
  topicSynonyms: Record<string, string[]>;

  /** How strongly to boost cross-company inference (0.5-1.5) */
  inferenceStrength: number;
}

export interface ClusterHotTopic {
  /** Topic keyword */
  topic: string;

  /** Company that was asked about it */
  sourceTicker: string;

  /** Quarter when asked (e.g., "Q4 2025") */
  sourceQuarter: string;

  /** Date of the earnings call */
  sourceDate: string;

  /** How many times analysts asked about this topic */
  analystMentions: number;

  /** Intensity score (mentions / total questions) */
  intensity: number;

  /** Companies in the cluster that haven't reported yet */
  pendingTickers: string[];

  /** Days since the source company's earnings */
  daysSinceSource: number;

  /** Confidence that others will be asked (decays over time) */
  inferenceConfidence: number;
}

export interface CompanyEarningsSchedule {
  ticker: string;
  company: string;
  nextEarningsDate?: string;
  lastEarningsDate?: string;
  fiscalYearEnd?: string;
}

// =============================================================================
// COMPANY CLUSTERS
// =============================================================================

export const COMPANY_CLUSTERS: CompanyCluster[] = [
  // RETAIL & GROCERS
  {
    id: 'grocers',
    name: 'Grocery & Supermarkets',
    tickers: ['KR', 'ACI', 'WMT', 'COST', 'TGT', 'SFM', 'GO', 'UNFI', 'SPTN'],
    sharedTopics: [
      'delivery', 'online ordering', 'same-store sales', 'shrinkage', 'theft',
      'private label', 'inflation', 'pricing', 'grocery margin', 'foot traffic',
      'click and collect', 'instacart', 'membership', 'loyalty program',
    ],
    topicSynonyms: {
      'delivery': ['delivery', 'last mile', 'home delivery', 'e-commerce fulfillment'],
      'shrinkage': ['shrinkage', 'theft', 'loss prevention', 'inventory loss', 'shoplifting'],
      'private label': ['private label', 'store brand', 'own brand', 'kirkland', 'good & gather'],
    },
    inferenceStrength: 1.2, // Strong inference - very similar business models
  },

  // AIRLINES
  {
    id: 'airlines',
    name: 'Airlines',
    tickers: ['UAL', 'DAL', 'AAL', 'LUV', 'JBLU', 'ALK', 'SAVE', 'HA'],
    sharedTopics: [
      'capacity', 'fuel costs', 'load factor', 'delays', 'premium cabin',
      'fleet', 'labor costs', 'pilot shortage', 'revenue per available seat mile',
      'RASM', 'CASM', 'ancillary revenue', 'loyalty program', 'basic economy',
    ],
    topicSynonyms: {
      'capacity': ['capacity', 'ASM', 'available seat miles', 'seats'],
      'fuel costs': ['fuel', 'jet fuel', 'fuel hedging', 'fuel expense'],
      'premium cabin': ['premium', 'first class', 'business class', 'polaris', 'delta one'],
    },
    inferenceStrength: 1.3, // Very strong - homogeneous industry
  },

  // BIG TECH
  {
    id: 'big-tech',
    name: 'Big Tech',
    tickers: ['AAPL', 'GOOGL', 'MSFT', 'META', 'AMZN', 'NVDA'],
    sharedTopics: [
      'AI', 'artificial intelligence', 'cloud', 'capex', 'headcount',
      'regulation', 'antitrust', 'data center', 'GPU', 'machine learning',
      'generative AI', 'LLM', 'advertising', 'enterprise', 'developer',
    ],
    topicSynonyms: {
      'AI': ['AI', 'artificial intelligence', 'machine learning', 'ML', 'generative AI', 'GenAI', 'LLM'],
      'cloud': ['cloud', 'AWS', 'Azure', 'GCP', 'cloud computing', 'infrastructure'],
      'regulation': ['regulation', 'antitrust', 'FTC', 'DOJ', 'EU', 'GDPR', 'DMA'],
    },
    inferenceStrength: 1.0, // Moderate - diverse business models
  },

  // BANKS
  {
    id: 'banks',
    name: 'Major Banks',
    tickers: ['JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'USB', 'PNC', 'TFC'],
    sharedTopics: [
      'net interest income', 'NII', 'credit losses', 'loan growth', 'deposits',
      'investment banking', 'trading', 'capital markets', 'commercial real estate',
      'CRE', 'office', 'credit card', 'delinquency', 'charge-off', 'reserve',
    ],
    topicSynonyms: {
      'net interest income': ['NII', 'net interest income', 'net interest margin', 'NIM'],
      'commercial real estate': ['CRE', 'commercial real estate', 'office loans', 'real estate exposure'],
      'credit losses': ['credit losses', 'provisions', 'charge-offs', 'delinquencies', 'NPL'],
    },
    inferenceStrength: 1.4, // Very strong - regulatory and macro exposure shared
  },

  // STREAMING & ENTERTAINMENT
  {
    id: 'streaming',
    name: 'Streaming & Entertainment',
    tickers: ['NFLX', 'DIS', 'WBD', 'PARA', 'CMCSA', 'AMZN'],
    sharedTopics: [
      'subscribers', 'churn', 'ARPU', 'content spend', 'advertising tier',
      'password sharing', 'bundling', 'theatrical', 'box office', 'sports rights',
      'linear decline', 'cord cutting', 'streaming profitability',
    ],
    topicSynonyms: {
      'subscribers': ['subscribers', 'subs', 'membership', 'paid members'],
      'advertising tier': ['ad tier', 'advertising tier', 'ad-supported', 'AVOD'],
      'content spend': ['content spend', 'content investment', 'production budget', 'content costs'],
    },
    inferenceStrength: 1.2,
  },

  // FOOD & BEVERAGE
  {
    id: 'food-beverage',
    name: 'Food & Beverage',
    tickers: ['KO', 'PEP', 'STZ', 'MCD', 'SBUX', 'CMG', 'DPZ', 'YUM', 'QSR'],
    sharedTopics: [
      'same-store sales', 'pricing', 'volume', 'traffic', 'GLP-1',
      'Ozempic', 'value menu', 'digital orders', 'drive-through', 'loyalty',
      'commodity costs', 'franchisee', 'international', 'menu innovation',
    ],
    topicSynonyms: {
      'GLP-1': ['GLP-1', 'Ozempic', 'Wegovy', 'weight loss drugs', 'appetite'],
      'same-store sales': ['same-store sales', 'comps', 'comparable sales', 'SSS'],
      'value menu': ['value', 'value menu', 'affordability', 'price sensitivity'],
    },
    inferenceStrength: 1.1,
  },

  // AUTOMOTIVE
  {
    id: 'automotive',
    name: 'Automotive',
    tickers: ['TSLA', 'F', 'GM', 'RIVN', 'LCID', 'TM', 'HMC', 'STLA'],
    sharedTopics: [
      'EV', 'electric vehicle', 'inventory', 'incentives', 'pricing',
      'production', 'deliveries', 'margin', 'supply chain', 'chips',
      'charging', 'autonomous', 'FSD', 'ADAS', 'tariff', 'Mexico',
    ],
    topicSynonyms: {
      'EV': ['EV', 'electric vehicle', 'BEV', 'battery electric', 'electrification'],
      'autonomous': ['autonomous', 'self-driving', 'FSD', 'ADAS', 'autopilot'],
      'tariff': ['tariff', 'import duty', 'trade policy', 'Mexico imports'],
    },
    inferenceStrength: 1.3,
  },

  // PHARMA
  {
    id: 'pharma',
    name: 'Pharmaceuticals',
    tickers: ['JNJ', 'PFE', 'MRK', 'ABBV', 'LLY', 'BMY', 'GILD', 'AMGN'],
    sharedTopics: [
      'pipeline', 'FDA', 'approval', 'patent cliff', 'biosimilar',
      'pricing', 'IRA', 'Medicare negotiation', 'obesity', 'oncology',
      'immunology', 'clinical trial', 'R&D', 'M&A',
    ],
    topicSynonyms: {
      'patent cliff': ['patent cliff', 'loss of exclusivity', 'LOE', 'generic competition'],
      'IRA': ['IRA', 'Inflation Reduction Act', 'Medicare negotiation', 'drug pricing'],
      'obesity': ['obesity', 'weight loss', 'GLP-1', 'Wegovy', 'Zepbound', 'Mounjaro'],
    },
    inferenceStrength: 1.1,
  },

  // ENERGY
  {
    id: 'energy',
    name: 'Oil & Gas',
    tickers: ['XOM', 'CVX', 'COP', 'OXY', 'SLB', 'HAL', 'EOG', 'DVN'],
    sharedTopics: [
      'production', 'Permian', 'oil price', 'natural gas', 'LNG',
      'refining', 'margins', 'capex', 'shareholder returns', 'buyback',
      'dividend', 'transition', 'emissions', 'methane', 'carbon capture',
    ],
    topicSynonyms: {
      'production': ['production', 'output', 'barrels', 'BOE', 'volumes'],
      'shareholder returns': ['shareholder returns', 'buyback', 'dividend', 'capital return'],
      'Permian': ['Permian', 'shale', 'unconventional', 'tight oil'],
    },
    inferenceStrength: 1.3,
  },

  // SEMICONDUCTORS
  {
    id: 'semiconductors',
    name: 'Semiconductors',
    tickers: ['NVDA', 'AMD', 'INTC', 'AVGO', 'QCOM', 'TXN', 'MU', 'LRCX', 'AMAT', 'KLAC'],
    sharedTopics: [
      'AI demand', 'data center', 'GPU', 'HBM', 'CoWoS', 'packaging',
      'inventory', 'cycle', 'automotive', 'mobile', 'PC', 'server',
      'China', 'export controls', 'CHIPS Act', 'foundry', 'leading edge',
    ],
    topicSynonyms: {
      'AI demand': ['AI demand', 'AI chips', 'accelerators', 'GPU demand'],
      'export controls': ['export controls', 'China restrictions', 'BIS', 'entity list'],
      'data center': ['data center', 'hyperscaler', 'cloud', 'enterprise'],
    },
    inferenceStrength: 1.4, // Very strong - cyclical industry with shared drivers
  },

  // HOMEBUILDERS
  {
    id: 'homebuilders',
    name: 'Homebuilders',
    tickers: ['LEN', 'DHI', 'TOL', 'KBH', 'PHM', 'NVR', 'MTH', 'TMHC'],
    sharedTopics: [
      'orders', 'backlog', 'cancellations', 'mortgage rates', 'incentives',
      'affordability', 'ASP', 'gross margin', 'land', 'lot supply',
      'build-to-rent', 'first-time buyer', 'move-up', 'entry-level',
    ],
    topicSynonyms: {
      'incentives': ['incentives', 'rate buydown', 'closing costs', 'concessions'],
      'affordability': ['affordability', 'pricing', 'entry-level', 'first-time buyer'],
      'orders': ['orders', 'net orders', 'new orders', 'bookings'],
    },
    inferenceStrength: 1.4, // Very strong - rates and housing market affect all
  },
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Find all clusters a company belongs to.
 */
export function getCompanyClusters(ticker: string): CompanyCluster[] {
  return COMPANY_CLUSTERS.filter(cluster =>
    cluster.tickers.includes(ticker.toUpperCase())
  );
}

/**
 * Find cluster by ID.
 */
export function getClusterById(clusterId: string): CompanyCluster | undefined {
  return COMPANY_CLUSTERS.find(c => c.id === clusterId);
}

/**
 * Get all companies in the same clusters as a given ticker.
 */
export function getClusterPeers(ticker: string): string[] {
  const peers = new Set<string>();
  const clusters = getCompanyClusters(ticker);

  for (const cluster of clusters) {
    for (const peer of cluster.tickers) {
      if (peer !== ticker.toUpperCase()) {
        peers.add(peer);
      }
    }
  }

  return Array.from(peers);
}

/**
 * Check if a topic is relevant to a cluster.
 */
export function isTopicRelevantToCluster(
  topic: string,
  cluster: CompanyCluster
): boolean {
  const topicLower = topic.toLowerCase();

  // Direct match in shared topics
  if (cluster.sharedTopics.some(t => topicLower.includes(t.toLowerCase()))) {
    return true;
  }

  // Check synonyms
  for (const [_, synonyms] of Object.entries(cluster.topicSynonyms)) {
    if (synonyms.some(s => topicLower.includes(s.toLowerCase()))) {
      return true;
    }
  }

  return false;
}

/**
 * Normalize a topic to its canonical form using synonyms.
 */
export function normalizeClusterTopic(
  topic: string,
  cluster: CompanyCluster
): string {
  const topicLower = topic.toLowerCase();

  for (const [canonical, synonyms] of Object.entries(cluster.topicSynonyms)) {
    if (synonyms.some(s => topicLower.includes(s.toLowerCase()))) {
      return canonical;
    }
  }

  // Return original if no synonym match
  return topic;
}

/**
 * Calculate inference confidence based on days since source earnings.
 * Confidence decays over time as the topic becomes stale.
 */
export function calculateInferenceConfidence(
  daysSinceSource: number,
  cluster: CompanyCluster,
  analystIntensity: number
): number {
  // Base confidence from cluster strength and analyst intensity
  const baseConfidence = Math.min(0.9, 0.3 + (cluster.inferenceStrength - 0.5) * 0.4 + analystIntensity * 0.3);

  // Time decay: half-life of 45 days (one earnings cycle)
  const halfLifeDays = 45;
  const decayFactor = Math.pow(0.5, daysSinceSource / halfLifeDays);

  // Floor at 10% confidence
  return Math.max(0.10, baseConfidence * decayFactor);
}

/**
 * Get companies in a cluster that have upcoming earnings (not yet reported this quarter).
 */
export function getPendingEarningsInCluster(
  cluster: CompanyCluster,
  reportedTicker: string,
  schedules: CompanyEarningsSchedule[]
): string[] {
  const now = new Date();
  const pending: string[] = [];

  for (const ticker of cluster.tickers) {
    if (ticker === reportedTicker.toUpperCase()) continue;

    const schedule = schedules.find(s => s.ticker === ticker);
    if (schedule?.nextEarningsDate) {
      const earningsDate = new Date(schedule.nextEarningsDate);
      if (earningsDate > now) {
        pending.push(ticker);
      }
    }
  }

  return pending;
}
