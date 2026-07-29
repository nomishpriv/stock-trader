'use strict';

const axios = require('axios');
const Groq = require('groq-sdk');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── NEWS SOURCES ───────────────────────────────────────────────────────────
const NEWS_SOURCES = [
  { name: 'Tribune Business', url: 'https://tribune.com.pk/feed/business', weight: 1.2 },
  { name: 'ARY News',         url: 'https://arynews.tv/feed/',             weight: 1.0 },
  { name: 'Dawn Business',    url: 'https://www.dawn.com/feeds/business',  weight: 1.3 },
];

const METTIS_APIS = [
  { name: 'Mettis Equity',      url: 'https://mettisglobal.news/Home/GetEquitylatestnews' },
  { name: 'Mettis Economy',     url: 'https://mettisglobal.news/Home/GetEconomylatestnews' },
  { name: 'Mettis Forex',       url: 'https://mettisglobal.news/Home/GetForexlatestnews' },
  { name: 'Mettis Global Biz',  url: 'https://mettisglobal.news/Home/GetGlobalBusinesslatestnews' },
  { name: 'Mettis Opinion',     url: 'https://mettisglobal.news/Home/GetMGOpinionlatestnews' },
  { name: 'Mettis Technical',   url: 'https://mettisglobal.news/Home/GetTechnicalAnalysislatestnews' },
  { name: 'Mettis Company',     url: 'https://mettisglobal.news/Home/GetCompanyAnalysislatestnews' },
  { name: 'Mettis Analyst',     url: 'https://mettisglobal.news/Home/GetAnalystBriefingSessionlatestnews' },
  { name: 'Mettis Stock Picks', url: 'https://mettisglobal.news/Home/GetStockPicks' },
];

const CACHE_TTL = 90000;
const HEADLINE_LIMIT = 12;
const MAX_AGE_HOURS = 6;

// ─── PSX SECTOR → TICKERS (expanded for better matching) ─────────────────────
const SECTOR_TICKERS = {
  'Banking':       ['MEBL', 'MCB', 'UBL', 'HBL', 'BAFL', 'ABL', 'BOP'],
  'Cement':        ['LUCK', 'DGKC', 'CHCC', 'MLCF', 'KOHC', 'FCCL', 'BWCL', 'PIOC'],
  'Oil & Gas':     ['PPL', 'PSO', 'SNGP', 'SSGC', 'OGDC', 'MARI', 'POL'],
  'Fertilizer':    ['EFERT', 'FFC', 'FATIMA', 'ENGRO', 'FFBL'],
  'Power':         ['HUBC', 'KEL', 'CPHL'],
  'Steel':         ['ISL', 'MUGHAL', 'ASTL'],
  'Textile':       ['GATM', 'GFIL', 'NML', 'NCL', 'ILP'],
  'Pharma':        ['SEARL', 'GLAXO', 'FEROZ', 'HINOON', 'AGP', 'ABOT'],
  'Technology':    ['SYS', 'TELE', 'AVN', 'NETSOL'],
  'Automobile':    ['HCAR', 'INDU', 'ATLH', 'SAZEW'],
  'Food & FMCG':   ['COLG', 'UNITY', 'NESTLE', 'RMPL'],
  'Chemical':      ['ARPL', 'LOTCHEM', 'ICI', 'EPCL'],
  'Real Estate':   ['DCR'],
  'Refinery':      ['ATRL', 'NRL', 'PRL'],
};

// Build reverse lookup: TICKER → SECTOR
const TICKER_TO_SECTOR = {};
for (const [sector, tickers] of Object.entries(SECTOR_TICKERS)) {
  for (const ticker of tickers) {
    TICKER_TO_SECTOR[ticker] = sector;
  }
}

// Expanded company name keywords for news matching
const COMPANY_KEYWORDS = {
  'PPL':    ['ppl', 'pakistan petroleum', 'ppl limited'],
  'OGDC':   ['ogdc', 'oil and gas development', 'ogdcl'],
  'MARI':   ['mari', 'mari petroleum', 'mari gas'],
  'POL':    ['pol', 'pakistan oilfields'],
  'PSO':    ['pso', 'pakistan state oil'],
  'LUCK':   ['luck', 'lucky cement'],
  'DGKC':   ['dgkc', 'dg khan cement'],
  'FCCL':   ['fccl', 'fauji cement'],
  'EFERT':  ['efert', 'engro fertilizer', 'engro fertiliser'],
  'FFC':    ['ffc', 'fauji fertilizer'],
  'ENGRO':  ['engro', 'engro corp', 'engro corporation'],
  'HUBC':   ['hubc', 'hub power', 'hubco'],
  'KEL':    ['kel', 'k-electric', 'k electric', 'kelectric'],
  'MEBL':   ['mebl', 'meezan bank', 'meezan'],
  'SYS':    ['sys', 'systems limited', 'systems ltd'],
  'SEARL':  ['searl', 'searle', 'searle company'],
  'GLAXO':  ['glaxo', 'gsk', 'glaxosmithkline'],
  'HINOON': ['hinoon', 'highnoon', 'high noon'],
  'ISL':    ['isl', 'international steel', 'isl steel'],
  'MUGHAL': ['mughal', 'mughal steel', 'mughal iron'],
  'HCAR':   ['hcar', 'honda car', 'honda atlas'],
  'ATRL':   ['atrl', 'attock refinery'],
  'NRL':    ['nrl', 'national refinery'],
  'SNGP':   ['sngp', 'sui northern', 'sngpl'],
  'SSGC':   ['ssgc', 'sui southern', 'ssgcl'],
};

// ─── SOURCE HEALTH TRACKER ───────────────────────────────────────────────────
const sourceHealth = new Map();

function isSourceHealthy(name) {
  const health = sourceHealth.get(name);
  if (!health) return true;
  if (health.failCount >= 3 && Date.now() - health.lastFail < 3600000) {
    return false;
  }
  return true;
}

function recordSourceFail(name) {
  const health = sourceHealth.get(name) || { failCount: 0, lastFail: 0 };
  health.failCount++;
  health.lastFail = Date.now();
  sourceHealth.set(name, health);
}

function recordSourceSuccess(name) {
  sourceHealth.delete(name);
}

// ─── CACHE ────────────────────────────────────────────────────────────────────
let cache = { data: null, ts: 0 };
let pendingPromise = null;

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const decodeEntities = (str) => str
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/<![^>]+>/g, '')
  .trim();

function isStale(pubDate) {
  if (!pubDate || isNaN(pubDate)) return false;
  return (Date.now() - pubDate.getTime()) / 3600000 > MAX_AGE_HOURS;
}

function deduplicate(items) {
  const seen = new Set();
  return items.filter(item => {
    if (!item?.title) return false;
    const key = item.title.toLowerCase().replace(/\W+/g, ' ').split(' ').slice(0, 6).join(' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── PSX RELEVANCE ───────────────────────────────────────────────────────────
const PSX_KEYWORDS = [
  'karachi stock', 'kse', 'psx', 'pkr', 'rupee', 'sbp', 'state bank',
  'imf', 'gdp', 'inflation', 'cpi', 'interest rate', 'fiscal', 'budget',
  'revenue', 'profit', 'earnings', 'dividend', 'listing', 'ipo',
  'oil price', 'gas', 'electricity', 'cement', 'steel', 'bank', 'textile',
  'export', 'import', 'current account', 'foreign reserve', 'dollar',
  'brent', 'crude', 'tax', 'duty', 'policy rate', 'mpd', 'monetary',
  'economic', 'economy', 'trade', 'investment', 'fdi', 'remittance',
];

function isPSXRelevant(title) {
  const lower = title.toLowerCase();
  return PSX_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Find which stock symbols a headline mentions
 */
function findMentionedTickers(title) {
  const lower = title.toLowerCase();
  const mentioned = [];
  
  for (const [ticker, keywords] of Object.entries(COMPANY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      mentioned.push(ticker);
    }
  }
  
  // Also check for bare ticker mentions (3-5 uppercase letters)
  const tickerRegex = /\b[A-Z]{3,5}\b/g;
  const matches = title.match(tickerRegex) || [];
  for (const match of matches) {
    if (TICKER_TO_SECTOR[match] && !mentioned.includes(match)) {
      mentioned.push(match);
    }
  }
  
  return mentioned;
}

/**
 * Find which sectors a headline affects
 */
function findAffectedSectors(title) {
  const mentionedTickers = findMentionedTickers(title);
  const sectors = new Set();
  
  for (const ticker of mentionedTickers) {
    const sector = TICKER_TO_SECTOR[ticker];
    if (sector) sectors.add(sector);
  }
  
  // Sector keyword matching
  const lower = title.toLowerCase();
  const sectorKeywords = {
    'Cement': ['cement', 'construction'],
    'Oil & Gas': ['oil', 'gas', 'petroleum', 'exploration', 'e&p'],
    'Banking': ['bank', 'banking', 'interest rate', 'monetary', 'sbp'],
    'Fertilizer': ['fertilizer', 'fertiliser', 'urea', 'dap'],
    'Power': ['power', 'electricity', 'energy', 'ipp'],
    'Textile': ['textile', 'cotton', 'yarn', 'garment', 'export'],
    'Pharma': ['pharma', 'pharmaceutical', 'drug', 'medicine'],
    'Steel': ['steel', 'iron', 'metal'],
    'Automobile': ['auto', 'car', 'vehicle', 'automobile'],
    'Technology': ['tech', 'software', 'it ', 'information technology'],
    'Refinery': ['refinery', 'refining', 'crude'],
  };
  
  for (const [sector, keywords] of Object.entries(sectorKeywords)) {
    if (keywords.some(kw => lower.includes(kw))) {
      sectors.add(sector);
    }
  }
  
  return {
    sectors: Array.from(sectors),
    tickers: mentionedTickers,
  };
}

// ─── FETCHERS ─────────────────────────────────────────────────────────────────
async function fetchRSS(source) {
  if (!isSourceHealthy(source.name)) return [];

  try {
    const { data } = await axios.get(source.url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      maxRedirects: 5,
    });

    if (typeof data === 'string' && data.trim().startsWith('<!DOCTYPE html>')) {
      recordSourceFail(source.name);
      return [];
    }

    const items = [];
    const itemRx = /<item[\s\S]*?<\/item>/gi;
    let m;

    while ((m = itemRx.exec(data)) !== null) {
      const block = m[0];
      const titleM = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(block);
      if (!titleM) continue;
      
      const title = decodeEntities(titleM[1]);
      if (!title || title.length < 15) continue;

      const dateM = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(block);
      const pubDate = dateM ? new Date(dateM[1].trim()) : null;
      if (isStale(pubDate)) continue;

      const linkM = /<link>([\s\S]*?)<\/link>/i.exec(block);
      const link = linkM ? decodeEntities(linkM[1]) : null;

      const affected = findAffectedSectors(title);

      items.push({
        title,
        pubDate,
        source: source.name,
        weight: source.weight,
        isPSX: isPSXRelevant(title),
        link,
        affectedSectors: affected.sectors,
        affectedTickers: affected.tickers,
      });
    }

    if (items.length > 0) recordSourceSuccess(source.name);
    return items;
  } catch (err) {
    recordSourceFail(source.name);
    return [];
  }
}

async function fetchMettisAPI(source) {
  try {
    const { data: rawData } = await axios.get(source.url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
      },
    });

    let data = rawData;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return []; }
    }

    if (!Array.isArray(data)) return [];

    return data.map(item => {
      const headingRaw = item?.Headings?.Heading;
      const descRaw = item?.Descriptions?.Description;
      const title = (Array.isArray(headingRaw) ? headingRaw[0] : headingRaw) ||
                    (Array.isArray(descRaw) ? descRaw[0] : descRaw) || '';
      if (!title || title.length < 10) return null;

      const dateField = item?.ModifyDateTime || item?.PublishedDate || item?.PublishedTime;
      const pubDate = dateField ? new Date(dateField) : null;
      if (isStale(pubDate)) return null;

      const tagNode = item?.Tags?.Tag;
      const tags = Array.isArray(tagNode) ? tagNode : (tagNode ? [tagNode] : []);
      const isPSX = tags.some(t => t?.TagName === 'KSE100' || t?.TagType === 'Indices' || t?.TagType === 'Companies');
      const psxCategories = ['Equity', 'FOREX', 'Economy', 'Technical Analysis', 'Company Analysis Research'];
      const isPSXByCategory = psxCategories.some(c => (item?.CategoryName || '').includes(c));

      const affected = findAffectedSectors(title);

      return {
        title,
        pubDate,
        source: source.name,
        weight: 1.5,
        isPSX: isPSX || isPSXByCategory,
        link: item?.Link ? `https://mettisglobal.news/news/${item.Link}` : null,
        affectedSectors: affected.sectors,
        affectedTickers: affected.tickers,
      };
    }).filter(Boolean);
  } catch (err) {
    return [];
  }
}

// ─── AI ANALYSIS ──────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert PSX intraday analyst. Read headlines and give precise trading signals.
Return ONLY raw JSON. No markdown.`;

function buildUserPrompt(headlines) {
  return `Today: ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} PKT

Headlines (last ${MAX_AGE_HOURS}h):
${headlines.map((h, i) => `${i + 1}. [${h.source}] ${h.title}`).join('\n')}

Return this JSON:
{
  "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "signal": "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL",
  "impactScore": <-10 to +10>,
  "confidence": <0-100>,
  "kse100Outlook": "UP" | "DOWN" | "SIDEWAYS",
  "affectedSectors": [
    {"sector": "<name>", "impact": "POSITIVE"|"NEGATIVE"|"NEUTRAL", "reason": "<1 line>"}
  ],
  "topTrades": [
    {"ticker": "<PSX symbol>", "action": "BUY"|"SELL", "reason": "<1 line>", "riskLevel": "LOW"|"MEDIUM"|"HIGH"}
  ],
  "keyRisk": "<biggest risk>",
  "summary": "<2-line summary>",
  "immediateAction": "<next 30 min action>"
}`;
}

async function analyzeWithGroq(headlines) {
  if (!process.env.GROQ_API_KEY || headlines.length === 0) return null;

  const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

  for (const model of models) {
    try {
      const chat = await groq.chat.completions.create({
        model,
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(headlines) },
        ],
      });

      const raw = chat.choices[0].message.content;
      const text = raw.replace(/```json|```/gi, '').trim();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON');

      const parsed = JSON.parse(text.slice(start, end + 1));
      parsed._model = model;
      return parsed;
    } catch (err) {
      console.warn(`⚠️ ${model} failed: ${err.message}`);
    }
  }
  return null;
}

// ─── ENRICHMENT ───────────────────────────────────────────────────────────────
function enrichWithTickers(ai) {
  if (ai?.affectedSectors) {
    ai.affectedSectors = ai.affectedSectors.map(s => ({
      ...s,
      watchlist: SECTOR_TICKERS[s.sector] || [],
    }));
  }
  if (ai?.topTrades) {
    ai.topTrades = ai.topTrades.map(t => ({
      ...t,
      ticker: t.ticker?.toUpperCase() || 'N/A',
    }));
  }
  return ai;
}

function signalMeta(signal) {
  const map = {
    STRONG_BUY:  { emoji: '🟢🟢', color: '#00c853', label: 'Strong Buy' },
    BUY:         { emoji: '🟢',   color: '#69f0ae', label: 'Buy' },
    HOLD:        { emoji: '🟡',   color: '#ffd740', label: 'Hold' },
    SELL:        { emoji: '🔴',   color: '#ff6d00', label: 'Sell' },
    STRONG_SELL: { emoji: '🔴🔴', color: '#d50000', label: 'Strong Sell' },
  };
  return map[signal] || map.HOLD;
}

// ─── MAIN EXPORTS ─────────────────────────────────────────────────────────────
async function getNewsImpact({ forceRefresh = false } = {}) {
  const now = Date.now();

  if (!forceRefresh && cache.data && (now - cache.ts) < CACHE_TTL) {
    return cache.data;
  }

  if (pendingPromise) return pendingPromise;

  const startTime = Date.now();

  pendingPromise = (async () => {
    try {
      const [rssResults, mettisResults] = await Promise.all([
        Promise.all(NEWS_SOURCES.map(fetchRSS)),
        Promise.all(METTIS_APIS.map(fetchMettisAPI)),
      ]);

      const allItems = [...mettisResults.flat(), ...rssResults.flat()];
      allItems.sort((a, b) => {
        const aTime = a.pubDate?.getTime?.() || Date.now();
        const bTime = b.pubDate?.getTime?.() || Date.now();
        return bTime - aTime;
      });

      const deduped = deduplicate(allItems);
      const relevant = deduped.filter(h => h.isPSX || isPSXRelevant(h.title));
      const fallback = deduped.filter(h => !h.isPSX && !isPSXRelevant(h.title));
      const finalList = [...relevant, ...fallback].slice(0, HEADLINE_LIMIT);

      const rawAI = await analyzeWithGroq(finalList);
      const aiAnalysis = rawAI ? enrichWithTickers(rawAI) : {
        sentiment: 'NEUTRAL', signal: 'HOLD', impactScore: 0, confidence: 0,
        kse100Outlook: 'SIDEWAYS', affectedSectors: [], topTrades: [],
        keyRisk: 'AI unavailable', summary: 'Trade on technicals',
        immediateAction: 'Wait for AI recovery', _model: 'none',
      };

      const result = {
        headlines: finalList.map(h => ({
          title: h.title,
          source: h.source,
          pubDate: h.pubDate instanceof Date ? h.pubDate.toISOString() : (h.pubDate || null),
          url: h.link || null,
          affectedSectors: h.affectedSectors || [],
          affectedTickers: h.affectedTickers || [],
        })),
        aiAnalysis,
        signalMeta: signalMeta(aiAnalysis.signal),
        meta: {
          totalFetched: allItems.length,
          uniqueHeadlines: deduped.length,
          psxRelevant: relevant.length,
          analyzedCount: finalList.length,
          fetchedAt: new Date(now).toISOString(),
          nextRefreshAt: new Date(now + CACHE_TTL).toISOString(),
        },
      };

      cache = { data: result, ts: now };
      return result;
    } catch (e) {
      console.error('❌ getNewsImpact failed:', e.message);
      return cache.data || {
        headlines: [],
        aiAnalysis: {
          sentiment: 'NEUTRAL', signal: 'HOLD', impactScore: 0, confidence: 0,
          kse100Outlook: 'SIDEWAYS', affectedSectors: [], topTrades: [],
          keyRisk: 'Service unavailable', summary: 'News fetch failed',
          immediateAction: 'Retry later', _model: 'none',
        },
        signalMeta: signalMeta('HOLD'),
        meta: { fetchedAt: new Date().toISOString() },
      };
    } finally {
      pendingPromise = null;
    }
  })();

  return pendingPromise;
}

async function getQuickSignal() {
  try {
    const impact = await getNewsImpact();
    const { aiAnalysis, signalMeta: meta } = impact;
    return {
      signal: aiAnalysis.signal,
      emoji: meta.emoji,
      sentiment: aiAnalysis.sentiment,
      impactScore: aiAnalysis.impactScore,
      confidence: aiAnalysis.confidence,
      immediateAction: aiAnalysis.immediateAction,
      summary: aiAnalysis.summary,
      topTrades: aiAnalysis.topTrades || [],
      affectedSectors: aiAnalysis.affectedSectors || [],
      fetchedAt: impact.meta.fetchedAt,
    };
  } catch {
    return {
      signal: 'HOLD', emoji: '🟡', sentiment: 'NEUTRAL',
      impactScore: 0, confidence: 0,
      immediateAction: 'Wait for data', summary: 'News unavailable',
      topTrades: [], affectedSectors: [],
      fetchedAt: new Date().toISOString(),
    };
  }
}

/**
 * Get news specifically relevant to a stock symbol
 */
async function getStockNews(symbol) {
  const impact = await getNewsImpact();
  const upperSymbol = symbol.toUpperCase();
  const sector = TICKER_TO_SECTOR[upperSymbol] || null;

  // Filter headlines mentioning this stock or its sector
  const relevantHeadlines = impact.headlines.filter(h => {
    const tickers = h.affectedTickers || [];
    const sectors = h.affectedSectors || [];
    return tickers.includes(upperSymbol) || (sector && sectors.includes(sector));
  }).slice(0, 5);

  // Get sector-specific AI analysis
  const sectorImpact = sector
    ? (impact.aiAnalysis.affectedSectors || []).find(s => s.sector === sector)
    : null;

  // Get stock-specific trade recommendation
  const stockTrade = (impact.aiAnalysis.topTrades || []).find(t => t.ticker === upperSymbol);

  // Also check headlines that might mention this stock by keyword
  const keywords = COMPANY_KEYWORDS[upperSymbol] || [];
  const keywordMatches = impact.headlines.filter(h => {
    const lower = h.title.toLowerCase();
    return keywords.some(kw => lower.includes(kw));
  }).slice(0, 3);

  return {
    symbol: upperSymbol,
    sector,
    relevantHeadlines: [...relevantHeadlines, ...keywordMatches].slice(0, 5),
    sectorImpact,
    stockTrade: stockTrade || null,
    overallSignal: impact.aiAnalysis.signal || 'HOLD',
    overallSentiment: impact.aiAnalysis.sentiment || 'NEUTRAL',
    summary: impact.aiAnalysis.summary || '',
    immediateAction: impact.aiAnalysis.immediateAction || '',
    keyRisk: impact.aiAnalysis.keyRisk || '',
    fetchedAt: impact.meta.fetchedAt,
  };
}

module.exports = {
  getNewsImpact,
  getQuickSignal,
  getStockNews,
  SECTOR_TICKERS,
  TICKER_TO_SECTOR,
};