require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// Import the auth service
const { api, getToken, testLogin } = require('./services/authService');

// Import order book service
const orderBookService = require('./services/orderBookService');

// Import news service
const { getQuickSignal, getNewsImpact, getStockNews, getNewsTicker, TICKER_TO_SECTOR } = require('./services/newsService');

// Import announcement service
const { getAnnouncements, getStockAnnouncement, getQuickAnnouncements } = require('./services/announcementService');

// Import trading signal service
const tradingSignalService = require('./services/tradingSignalService');

// Import index tracker service
const indexTrackerService = require('./services/indexTrackerService');

// Import order flow tracker service
const orderFlowTracker = require('./services/orderFlowTrackerService');

// Import institutional tracker service
const institutionalTracker = require('./services/institutionalTrackerService');

// Import trade journal service
const tradeJournal = require('./services/tradeJournalService');

// Import global indices service
const globalIndicesService = require('./services/globalIndicesService');

// ─── NEW: Smart Money Services ───────────────────────────────────────────
const { getFipiLipData, getWeeklyTrend } = require('./services/fipiLipService');
const institutionalMoodService = require('./services/institutionalMoodService');
const smartMoneyTrendService = require('./services/smartMoneyTrendService');
const sectorRotationService = require('./services/sectorRotationService');
// ─────────────────────────────────────────────────────────────────────────

const { getSectorForSymbol, getStocksForSector, getAllSectors } = require('./services/sectorMappingService');
const sectorAnalysisService = require('./services/sectorAnalysisService');


const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// State
let isLoggedIn = false;
let stockCache = [];
let clients = new Set();
const UPDATE_INTERVAL = 3000;
const NEWS_INTERVAL = 90000;
const ANN_INTERVAL = 300000;
const INDEX_TRACKER_INTERVAL = 900000;
const ORDERFLOW_TRACK_INTERVAL = 120000;
const ORDERFLOW_BROADCAST_INTERVAL = 30000;
const GLOBAL_INDICES_INTERVAL = 300000;
const INSTITUTIONAL_INTERVAL = 45000;

// ============ FETCH MARKET DATA ============
async function fetchMarketData() { try { const { data } = await api.get('/market'); return data; } catch (e) { throw e; } }

async function fetchAllStocks() {
  try {
    const data = await fetchMarketData();
    const raw = data?.data?.eq;
    if (!raw) return [];
    const kseData = data?.data?.in?.KSE100;
    const stocks = Object.entries(raw)
      .filter(([sym, s]) => {
        if (!s.c || +s.c <= 0) return false;
        if (+s.c < 2 && +s.v < 10000) return false;
        if (s.nm) { 
          const name = s.nm.toLowerCase(); 
          if (name.includes('(right)') || name.includes('(r)') || 
              name.endsWith(' right') || name.includes('right)') || 
              name.includes(' right ') || (name.startsWith('right') && name.length < 20)) 
            return false; 
        }
        if (/R\d+$/.test(sym)) return false;
        if (s.st === 2) return false;
        if (!s.sh || +s.sh === 0) return false;
        if (!s.nm || s.nm.trim() === '') return false;
        if (!s.v || +s.v === 0) return false;
        return true;
      })
      .map(([sym, s]) => ({
        symbol: sym, name: s.nm, price: +s.c, open: +s.o, high: +s.h, low: +s.l,
        volume: +s.v, change: +s.ch, changePercent: +((s.pch || 0) * 100).toFixed(2),
        rsi: +(s.rsi ?? 0), pivot: +(s.pp?.pp ?? 0), r1: +(s.pp?.r1 ?? 0), r2: +(s.pp?.r2 ?? 0),
        s1: +(s.pp?.s1 ?? 0), s2: +(s.pp?.s2 ?? 0), pe: +(s.pr ?? 0), eps: +(s.eps ?? 0),
        divYield: +(s.di ?? 0), bidPrice: s.bidp ? +s.bidp : 0, bidVolume: s.bidv ? +s.bidv : 0,
        askPrice: s.askp ? +s.askp : 0, askVolume: s.askv ? +s.askv : 0,
        upperCircuit: +s.uc, lowerCircuit: +s.lc, status: 'ACTIVE', lastUpdate: s.d,shares: +s.sh || 0,
        signal: calculateSignal(s)
      }));
    console.log(`📊 Stocks: ${stocks.length} loaded`);
    return { stocks, kse100: kseData ? { value: +kseData.c, change: +kseData.ch, changePercent: +((kseData.pch || 0) * 100).toFixed(2), volume: +kseData.v, high: +kseData.h, low: +kseData.l } : null };
  } catch (e) { console.error('Fetch error:', e.message); return { stocks: [], kse100: null }; }
}

function calculateSignal(s) { const pch = s.pch || 0, rsi = s.rsi || 50; let score = 0; if (pch > 0.01) score++; if (pch < -0.01) score--; if (rsi < 40) score++; if (rsi > 60) score--; if (score >= 2) return 'STRONG_BUY'; if (score === 1) return 'BUY'; if (score === -1) return 'SELL'; if (score <= -2) return 'STRONG_SELL'; return 'NEUTRAL'; }

// ============ ORDER BOOK FUNCTIONS ============
async function fetchOrderBookForSymbol(symbol) { try { const { data } = await api.get('/trading/subscribe', { params: { symbol: symbol.toUpperCase() }, timeout: 8000 }); if (data?.data?.ob) { const orderBook = parseOrderBook(data.data); orderBookService.orderBooks.set(symbol.toUpperCase(), { ...orderBook, timestamp: Date.now() }); return orderBook; } return null; } catch (error) { return null; } }

function parseOrderBook(rawData) {
  const ob = rawData.ob; const bids = (ob.bl || []).map(l => ({ price: l.x, volume: l.v, orders: l.on, level: l.lv })); const asks = (ob.sl || []).map(l => ({ price: l.x, volume: l.v, orders: l.on, level: l.lv }));
  const totalBidVolume = bids.reduce((s, b) => s + b.volume, 0); const totalAskVolume = asks.reduce((s, a) => s + a.volume, 0);
  const bestBid = bids[0] || null, bestAsk = asks[0] || null; const spread = bestBid && bestAsk ? bestAsk.price - bestBid.price : 0; const spreadPercent = bestBid ? (spread / bestBid.price) * 100 : 0;
  const bidAskRatio = totalAskVolume > 0 ? totalBidVolume / totalAskVolume : 0; let pressure = 'NEUTRAL';
  if (bidAskRatio > 1.5) pressure = 'STRONG_BUY'; else if (bidAskRatio > 1.2) pressure = 'BUY'; else if (bidAskRatio < 0.67) pressure = 'STRONG_SELL'; else if (bidAskRatio < 0.83) pressure = 'SELL';
  const largeOrders = []; [...bids, ...asks].forEach(o => { if (o.volume > 5000) largeOrders.push({ type: bids.includes(o) ? 'BID' : 'ASK', price: o.price, volume: o.volume, impact: o.volume > 20000 ? 'HIGH' : o.volume > 10000 ? 'MEDIUM' : 'LOW' }); });
  return { symbol: ob.s, market: ob.m, timestamp: ob.t, bestBid: bestBid?.price || 0, bestAsk: bestAsk?.price || 0, spread: +spread.toFixed(2), spreadPercent: +spreadPercent.toFixed(2), totalBidVolume, totalAskVolume, bidAskRatio: +bidAskRatio.toFixed(2), pressure, bids: bids.slice(0, 10), asks: asks.slice(0, 10), bidSummary: ob.bs || { x: 0, v: 0 }, askSummary: ob.ss || { x: 0, v: 0 }, top3BidVol: bids.slice(0, 3).reduce((s, b) => s + b.volume, 0), top3AskVol: asks.slice(0, 3).reduce((s, a) => s + a.volume, 0), largeOrders, support: bestBid?.price || 0, resistance: bestAsk?.price || 0, strongSupport: bids.length ? bids.reduce((max, b) => b.volume > max.volume ? b : max, bids[0]) : null, strongResistance: asks.length ? asks.reduce((max, a) => a.volume > max.volume ? a : max, asks[0]) : null, imbalance: +((totalBidVolume - totalAskVolume) / (totalBidVolume + totalAskVolume || 1) * 100).toFixed(1), trapDetection: null };
}

function detectOrderBookTraps(parsedBook, stockData) {
    if (!parsedBook || !parsedBook.bids || !parsedBook.asks) {
        return { confidence: 50, isFakeWall: false, isSpoofing: false, isLowLiquidity: false, warnings: ['Insufficient order book data'], realSignal: 'NEUTRAL' };
    }

    const warnings = [];
    let isFakeWall = false;
    let isSpoofing = false;
    let isLowLiquidity = false;
    let confidence = 100;
    let realSignal = parsedBook.pressure || 'NEUTRAL';

    const bids = parsedBook.bids || [];
    const asks = parsedBook.asks || [];
    const totalBidVol = parsedBook.totalBidVolume || 1;
    const totalAskVol = parsedBook.totalAskVolume || 1;
    const spreadPercent = parsedBook.spreadPercent || 0;
    const bidAskRatio = parsedBook.bidAskRatio || 1;
    const imbalance = parsedBook.imbalance || 0;
    const price = stockData?.price || parsedBook.bestBid || 0;
    const upperCircuit = stockData?.upperCircuit || 0;
    const lowerCircuit = stockData?.lowerCircuit || 0;
    const dayVolume = stockData?.volume || 0;

    if (spreadPercent > 2.0) { isLowLiquidity = true; warnings.push(`⚠️ Very wide spread ${spreadPercent.toFixed(2)}% — illiquid`); confidence -= 25; }
    else if (spreadPercent > 1.0) { isLowLiquidity = true; warnings.push(`⚠️ Wide spread ${spreadPercent.toFixed(2)}% — low liquidity`); confidence -= 15; }
    else if (spreadPercent > 0.5) { warnings.push(`⚠️ Elevated spread ${spreadPercent.toFixed(2)}%`); confidence -= 5; }

    if (bids.length < 3 || asks.length < 3) { isLowLiquidity = true; warnings.push('📉 Shallow order book (< 3 levels)'); confidence -= 15; }
    if (dayVolume < 30000 && spreadPercent > 0.4) { isLowLiquidity = true; warnings.push('💤 Thinly traded — use limit orders only'); confidence -= 10; }

    const topBidVol = bids[0]?.volume || 0;
    const topAskVol = asks[0]?.volume || 0;
    const topBidConcentration = (topBidVol / totalBidVol) * 100;
    const topAskConcentration = (topAskVol / totalAskVol) * 100;
    const next2BidVol = bids.slice(1, 3).reduce((s, b) => s + (b?.volume || 0), 0);
    const next2AskVol = asks.slice(1, 3).reduce((s, a) => s + (a?.volume || 0), 0);
    const bidDropoff = next2BidVol > 0 ? topBidVol / next2BidVol : 999;
    const askDropoff = next2AskVol > 0 ? topAskVol / next2AskVol : 999;

    const isRoundPrice = (p) => { if (!p) return false; const dec = Math.round((p % 1) * 100) / 100; return dec === 0 || dec === 0.5 || dec === 0.25 || dec === 0.75 || dec === 0.2 || dec === 0.8; };

    if (topBidConcentration > 60 && bidDropoff > 8) { isFakeWall = true; warnings.push(`🧱 Fake bid wall @ ${bids[0]?.price?.toFixed(2)} — ${_formatVol(topBidVol)} (${topBidConcentration.toFixed(0)}% of all bids)`); confidence -= 20; }
    if (topAskConcentration > 60 && askDropoff > 8) { isFakeWall = true; warnings.push(`🧱 Fake ask wall @ ${asks[0]?.price?.toFixed(2)} — ${_formatVol(topAskVol)} (${topAskConcentration.toFixed(0)}% of all asks)`); confidence -= 20; }

    if (upperCircuit > 0 && asks[0]?.price >= upperCircuit * 0.998 && topAskVol > totalAskVol * 0.35) { isFakeWall = true; warnings.push(`🚧 Ask wall at upper circuit — blocking rally`); confidence -= 10; }
    if (lowerCircuit > 0 && bids[0]?.price <= lowerCircuit * 1.002 && topBidVol > totalBidVol * 0.35) { isFakeWall = true; warnings.push(`🚧 Bid wall at lower circuit — artificial support`); confidence -= 10; }

    bids.slice(0, 3).forEach((b, i) => { if (isRoundPrice(b.price) && b.volume > 15000 && b.volume > ((bids[i + 1]?.volume || 1) * 5)) { isFakeWall = true; warnings.push(`🎯 Round-number bid ${b.price.toFixed(2)} with ${_formatVol(b.volume)} — no depth behind`); confidence -= 8; } });
    asks.slice(0, 3).forEach((a, i) => { if (isRoundPrice(a.price) && a.volume > 15000 && a.volume > ((asks[i + 1]?.volume || 1) * 5)) { isFakeWall = true; warnings.push(`🎯 Round-number ask ${a.price.toFixed(2)} with ${_formatVol(a.volume)} — no depth behind`); confidence -= 8; } });

    if ((bidAskRatio > 5 || bidAskRatio < 0.2) && spreadPercent > 0.8) { isSpoofing = true; warnings.push(`👻 Extreme ratio (${bidAskRatio.toFixed(1)}) + wide spread — possible spoofing`); confidence -= 20; }

    const top3BidPct = (parsedBook.top3BidVol / totalBidVol) * 100;
    const top3AskPct = (parsedBook.top3AskVol / totalAskVol) * 100;
    if (top3BidPct > 90 || top3AskPct > 90) { isSpoofing = true; warnings.push(`🎭 Book concentrated in top 3 levels — genuine depth lacking`); confidence -= 15; }

    const priceChange = stockData?.changePercent || 0;
    if (imbalance > 30 && priceChange < -1.5) { warnings.push(`🎭 Book shows buying (+${imbalance}%) but price falling — hidden selling`); confidence -= 10; }
    else if (imbalance < -30 && priceChange > 1.5) { warnings.push(`🎭 Book shows selling (${imbalance}%) but price rising — hidden buying`); confidence -= 10; }

    const signalRank = { 'STRONG_BUY': 4, 'BUY': 3, 'NEUTRAL': 2, 'SELL': 1, 'STRONG_SELL': 0 };
    const rankToSignal = ['STRONG_SELL', 'SELL', 'NEUTRAL', 'BUY', 'STRONG_BUY'];
    let level = signalRank[realSignal] ?? 2;

    if (isFakeWall) {
        if (bidAskRatio > 1.3 && topBidConcentration > 50) { level = Math.max(0, level - 2); warnings.push('🔻 Downgraded: fake buy pressure detected'); }
        else if (bidAskRatio < 0.77 && topAskConcentration > 50) { level = Math.min(4, level + 2); warnings.push('🔺 Upgraded: fake sell wall means real buying'); }
    }

    if (isLowLiquidity && !isFakeWall) { level = 2 + Math.round((level - 2) * 0.5); warnings.push('⚖️ Signal dampened: low liquidity'); }
    if (isSpoofing) { level = 2; warnings.push('⛔ Signal invalidated: spoofing detected'); }

    realSignal = rankToSignal[level] || 'NEUTRAL';
    confidence = Math.max(15, Math.min(100, confidence));
    const uniqueWarnings = [...new Set(warnings)];

    return { confidence, isFakeWall, isSpoofing, isLowLiquidity, warnings: uniqueWarnings.slice(0, 6), realSignal };
}
function _formatVol(v) { if (!v) return '0'; if (v >= 1000000) return (v/1000000).toFixed(1) + 'M'; if (v >= 1000) return (v/1000).toFixed(0) + 'K'; return v.toString(); }

// ============ TRADE JOURNAL HELPERS ============
function calculateQuantity(signal) { const capital = 100000; const riskAmount = capital * 0.02; const stopDistance = Math.abs((signal.entryPrice||signal.price) - signal.stopLoss); if (stopDistance <= 0) return 100; return Math.max(10, Math.min(10000, Math.floor(riskAmount / stopDistance))); }

// ============ HELPERS ============
function findSectorForStock(symbol) { return TICKER_TO_SECTOR[symbol.toUpperCase()] || null; }
async function fetchNewsAndBroadcast() { try { const s = await getQuickSignal(); if (s) broadcast({ type: 'NEWS_SIGNAL', data: s }); } catch (e) {} }
async function fetchAnnouncementsAndBroadcast() { 
    try { 
        const a = await getAnnouncements(); 
        if (a) {
            broadcast({ 
                type: 'ANNOUNCEMENTS', 
                data: {
                    announcements: a.announcements || [],
                    total: a.total || 0,
                    highImpact: a.highImpact || [],
                    tabs: a.tabs || [],
                    byType: a.byType || {},
                    typeCounts: a.typeCounts || {},
                    positive: a.positive || [],
                    negative: a.negative || [],
                    results: a.results || [],
                    dividends: a.dividends || [],
                    boardMeetings: a.boardMeetings || [],
                    materialInfo: a.materialInfo || [],
                    updates: a.updates || [],
                    timestamp: a.timestamp
                }
            });
        }
    } catch (e) {
        console.error('Announcements broadcast error:', e);
    }
}

// ─── NEW: Enhanced Sector Analysis with Mood + Rotation + Signals ────────
async function buildSectorAnalysis() {
    const [fipiData, newsSignal, announcements] = await Promise.all([
        getFipiLipData({ stockData: stockCache.stocks }).catch(() => null),
        getQuickSignal().catch(() => null),
        getAnnouncements().catch(() => null)
    ]);

    const tradeSignals = tradingSignalService.generateSignals(
        stockCache.stocks || [],
        newsSignal,
        announcements,
        stockCache.kse100,
        institutionalTracker.getAllSignals(),
        orderFlowTracker.getAllBuyRatios()
    );

    // NEW: Pass marketIndex for mood detection
    const marketIndex = stockCache.kse100 ? { 
        changePercent: stockCache.kse100.changePercent 
    } : null;

    return sectorAnalysisService.analyze(
        stockCache.stocks || [],
        fipiData,
        orderFlowTracker.getTopStocks(50),
        { signals: institutionalTracker.getActiveSignals(50) },
        tradeSignals,
        newsSignal,
        announcements,
        marketIndex
    );
}

// NEW: Build just the mood analysis (lightweight)
async function buildMoodAnalysis() {
    const fipiData = await getFipiLipData({ stockData: stockCache.stocks }).catch(() => null);
    const marketIndex = stockCache.kse100 ? { changePercent: stockCache.kse100.changePercent } : null;
    return institutionalMoodService.analyzeMood(fipiData, stockCache.stocks || [], marketIndex);
}
// ─────────────────────────────────────────────────────────────────────────

// ============ WEBSOCKET ============
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'LOGIN_STATUS', loggedIn: isLoggedIn }));
  if (stockCache.stocks?.length) ws.send(JSON.stringify({ type: 'MARKET_DATA', data: stockCache }));

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      switch(data.type) {
        case 'LOGIN': const token = await getToken(); if (token) { isLoggedIn = true; ws.send(JSON.stringify({ type: 'LOGIN_SUCCESS' })); broadcast({ type: 'LOGIN_STATUS', loggedIn: true }); await updateStocks(); fetchNewsAndBroadcast(); fetchAnnouncementsAndBroadcast(); } else ws.send(JSON.stringify({ type: 'LOGIN_ERROR', message: 'Login failed' })); break;
        case 'GET_STOCK': ws.send(JSON.stringify({ type: 'STOCK_DETAIL', data: stockCache.stocks?.find(s => s.symbol === data.symbol?.toUpperCase()) || null })); break;
        case 'GET_ORDERBOOK': if (data.symbol) { try { let ob = orderBookService.getCachedOrderBook(data.symbol); if (!ob) ob = await fetchOrderBookForSymbol(data.symbol); if (ob && stockCache.stocks) { const sd = stockCache.stocks.find(s => s.symbol === data.symbol?.toUpperCase()); if (sd) ob.trapDetection = detectOrderBookTraps(ob, sd); } ws.send(JSON.stringify({ type: 'ORDERBOOK_UPDATE', data: ob })); } catch (e) { ws.send(JSON.stringify({ type: 'ORDERBOOK_ERROR', symbol: data.symbol, message: e.message })); } } break;
        case 'GET_NEWS_SIGNAL': try { ws.send(JSON.stringify({ type: 'NEWS_SIGNAL', data: await getQuickSignal() })); } catch (e) { ws.send(JSON.stringify({ type: 'NEWS_SIGNAL', data: null })); } break;
        case 'GET_STOCK_NEWS': if (data.symbol) { try { ws.send(JSON.stringify({ type: 'STOCK_NEWS', symbol: data.symbol, data: await getStockNews(data.symbol) })); } catch (e) { ws.send(JSON.stringify({ type: 'STOCK_NEWS', symbol: data.symbol, data: null })); } } break;
        case 'GET_NEWS_TICKER': try { ws.send(JSON.stringify({ type: 'NEWS_TICKER', data: await getNewsTicker() })); } catch (e) { ws.send(JSON.stringify({ type: 'NEWS_TICKER', data: [] })); } break;
        case 'GET_ANNOUNCEMENTS': 
    try { 
        const annData = await getAnnouncements();
        ws.send(JSON.stringify({ 
            type: 'ANNOUNCEMENTS', 
            data: {
                announcements: annData.announcements || [],
                total: annData.total || 0,
                highImpact: annData.highImpact || [],
                tabs: annData.tabs || [],
                byType: annData.byType || {},
                typeCounts: annData.typeCounts || {},
                positive: annData.positive || [],
                negative: annData.negative || [],
                results: annData.results || [],
                dividends: annData.dividends || [],
                boardMeetings: annData.boardMeetings || [],
                materialInfo: annData.materialInfo || [],
                updates: annData.updates || [],
                timestamp: annData.timestamp
            }
        }));
    } catch (e) { 
        console.error('Announcements error:', e);
        ws.send(JSON.stringify({ type: 'ANNOUNCEMENTS', data: null })); 
    } 
    break;
        case 'GET_STOCK_ANNOUNCEMENT': if (data.symbol) { try { ws.send(JSON.stringify({ type: 'STOCK_ANNOUNCEMENT', symbol: data.symbol, data: await getStockAnnouncement(data.symbol) })); } catch (e) { ws.send(JSON.stringify({ type: 'STOCK_ANNOUNCEMENT', symbol: data.symbol, data: null })); } } break;
        case 'GET_TRADING_SIGNALS': 
    try { 
        const ns = await getQuickSignal(); 
        const ann = await getAnnouncements();
        ws.send(JSON.stringify({ 
            type: 'TRADING_SIGNALS', 
            data: tradingSignalService.generateSignals(stockCache.stocks || [], ns, ann, stockCache.kse100, institutionalTracker.getAllSignals(), orderFlowTracker.getAllBuyRatios()) 
        })); 
    } catch (e) { 
        ws.send(JSON.stringify({ type: 'TRADING_SIGNALS', data: [] })); 
    } 
    break;
        case 'GET_PREMARKET': try { ws.send(JSON.stringify({ type: 'PREMARKET', data: await tradingSignalService.analyzePreMarket(stockCache.stocks || [], orderBookService) })); } catch (e) { ws.send(JSON.stringify({ type: 'PREMARKET', data: [] })); } break;
        case 'ANALYZE_PREMARKET': try { ws.send(JSON.stringify({ type: 'PREMARKET_ANALYSIS', data: await tradingSignalService.analyzePreMarketSession(stockCache.stocks || [], orderBookService) })); } catch (e) { ws.send(JSON.stringify({ type: 'PREMARKET_ANALYSIS', data: { isPreMarket: false, message: 'Analysis failed', signals: [] } })); } break;
        case 'GET_INDEX_TRACKER': try { ws.send(JSON.stringify({ type: 'INDEX_TRACKER', data: indexTrackerService.getTrackerData() })); } catch (e) { ws.send(JSON.stringify({ type: 'INDEX_TRACKER', data: null })); } break;
        case 'GET_ORDERFLOW': try { const fd = orderFlowTracker.getData(); ws.send(JSON.stringify({ type: 'ORDERFLOW', data: { summary: fd.summary, remarks: fd.remarks, topStocks: orderFlowTracker.getTopStocks(15), hourlyFlow: orderFlowTracker.getHourlyFlow(), largeTrades: orderFlowTracker.getLargeTrades(20) } })); } catch (e) { ws.send(JSON.stringify({ type: 'ORDERFLOW', data: null })); } break;
        case 'GET_GLOBAL_INDICES': try { ws.send(JSON.stringify({ type: 'GLOBAL_INDICES', data: await globalIndicesService.fetchGlobalIndices() })); } catch (e) { ws.send(JSON.stringify({ type: 'GLOBAL_INDICES', data: null })); } break;
        case 'ANALYZE_INSTITUTIONAL': try { const results = []; const topStocks = (stockCache.stocks || []).sort((a, b) => b.volume - a.volume).slice(0, 20); for (const stock of topStocks) { let ob = orderBookService.getCachedOrderBook(stock.symbol);
if (!ob) ob = await fetchOrderBookForSymbol(stock.symbol);
const entry = await institutionalTracker.analyzeStock(stock, ob); if (entry) results.push({ symbol: stock.symbol, entry }); } ws.send(JSON.stringify({ type: 'INSTITUTIONAL_SIGNALS', data: { signals: institutionalTracker.getActiveSignals(55), alerts: institutionalTracker.getAlerts(10), analyzed: results.length } })); } catch (e) { ws.send(JSON.stringify({ type: 'INSTITUTIONAL_SIGNALS', data: { signals: [], alerts: [] } })); } break;
        case 'GET_INSTITUTIONAL_SIGNALS': try { ws.send(JSON.stringify({ type: 'INSTITUTIONAL_SIGNALS', data: { signals: institutionalTracker.getActiveSignals(50), alerts: institutionalTracker.getAlerts(15) } })); } catch (e) { ws.send(JSON.stringify({ type: 'INSTITUTIONAL_SIGNALS', data: { signals: [], alerts: [] } })); } break;
        case 'GET_STOCK_INSTITUTIONAL': if (data.symbol) { try { ws.send(JSON.stringify({ type: 'STOCK_INSTITUTIONAL', symbol: data.symbol, data: institutionalTracker.getStockHistory(data.symbol) })); } catch (e) { ws.send(JSON.stringify({ type: 'STOCK_INSTITUTIONAL', symbol: data.symbol, data: null })); } } break;

        case 'GET_SECTOR_STOCKS':
    if (data.sector) {
        const symbols = getStocksForSector(data.sector);
        const sectorStocks = (stockCache.stocks || []).filter(s => 
            symbols.includes(s.symbol.toUpperCase())
        );
        ws.send(JSON.stringify({ 
            type: 'SECTOR_STOCKS', 
            sector: data.sector,
            data: sectorStocks 
        }));
    }
    break;

        // ============ TRADE JOURNAL ============
        case 'OPEN_TRADE': try { ws.send(JSON.stringify({ type: 'TRADE_OPENED', data: tradeJournal.openTrade(data) })); } catch (e) { ws.send(JSON.stringify({ type: 'TRADE_ERROR', message: e.message })); } break;
        case 'CLOSE_TRADE': try { ws.send(JSON.stringify({ type: 'TRADE_CLOSED', data: tradeJournal.closeTrade(data.tradeId, data.exitPrice, data.reason||'MANUAL', data.note) })); } catch (e) { ws.send(JSON.stringify({ type: 'TRADE_ERROR', message: e.message })); } break;
        case 'AVERAGE_DOWN': try { ws.send(JSON.stringify({ type: 'TRADE_AVERAGED', data: tradeJournal.averageDown(data.tradeId, data.quantity, data.price) })); } catch (e) { ws.send(JSON.stringify({ type: 'TRADE_ERROR', message: e.message })); } break;
        case 'GET_TRADES': try { ws.send(JSON.stringify({ type: 'TRADES_DATA', data: tradeJournal.getAllTrades() })); } catch (e) { ws.send(JSON.stringify({ type: 'TRADES_DATA', data: null })); } break;
        case 'TAKE_TRADE_FROM_SIGNAL': try { const { signal } = data; const trade = tradeJournal.openTrade({ symbol: signal.symbol, name: signal.name, signal: signal.signal, tradeType: signal.tradeType||'DAY', entryPrice: signal.entryPrice||signal.price, targetPrice: signal.targetPrice, stopLoss: signal.stopLoss, quantity: data.quantity||calculateQuantity(signal), riskReward: signal.riskReward, riskLevel: signal.riskLevel, source: 'SIGNAL_TAB' }); ws.send(JSON.stringify({ type: 'TRADE_OPENED', data: trade })); } catch (e) { ws.send(JSON.stringify({ type: 'TRADE_ERROR', message: e.message })); } break;

        // ─── NEW: Enhanced FIPI/LIPI with Mood ────────────────────────────
        case 'GET_FIPILIPI':
            try {
                const fipiData = await getFipiLipData({ stockData: stockCache.stocks });
                const marketIndex = stockCache.kse100 ? { changePercent: stockCache.kse100.changePercent } : null;
                const moodAnalysis = institutionalMoodService.analyzeMood(fipiData, stockCache.stocks || [], marketIndex);
                ws.send(JSON.stringify({ 
                    type: 'FIPILIPI_DATA', 
                    data: {
                        ...fipiData,
                        institutionalMood: moodAnalysis
                    }
                }));
            } catch (e) {
                ws.send(JSON.stringify({ type: 'FIPILIPI_DATA', data: null }));
            }
            break;

        case 'GET_FIPILIPI_WEEKLY':
            try {
                const weeklyData = await getWeeklyTrend();
                ws.send(JSON.stringify({ type: 'FIPILIPI_WEEKLY', data: weeklyData }));
            } catch (e) {
                ws.send(JSON.stringify({ type: 'FIPILIPI_WEEKLY', data: [] }));
            }
            break;

        // ─── NEW: Institutional Mood endpoint ─────────────────────────────
        case 'GET_INSTITUTIONAL_MOOD':
            try {
                const moodAnalysis = await buildMoodAnalysis();
                ws.send(JSON.stringify({ 
                    type: 'INSTITUTIONAL_MOOD', 
                    data: moodAnalysis 
                }));
            } catch (e) {
                ws.send(JSON.stringify({ type: 'INSTITUTIONAL_MOOD', data: null }));
            }
            break;

        // ─── NEW: Smart Money Signals endpoint ────────────────────────────
        case 'GET_SMART_MONEY_SIGNALS':
            try {
                const analysis = await buildSectorAnalysis();
                ws.send(JSON.stringify({ 
                    type: 'SMART_MONEY_SIGNALS', 
                    data: analysis.signals 
                }));
            } catch (e) {
                ws.send(JSON.stringify({ type: 'SMART_MONEY_SIGNALS', data: null }));
            }
            break;

        case 'GET_SECTORS':
            try {
                const analysis = await buildSectorAnalysis();
                ws.send(JSON.stringify({ 
                    type: 'SECTORS_DATA', 
                    data: { 
                        sectors: analysis.sectors,
                        institutionalMood: analysis.institutionalMood,
                        sectorRotation: analysis.sectorRotation,
                        signals: analysis.signals,
                        executiveSummary: analysis.executiveSummary
                    }
                }));
            } catch (e) {
                console.error('Sector analysis error:', e);
                ws.send(JSON.stringify({ type: 'SECTORS_DATA', data: { sectors: [] } }));
            }
            break;

        case 'SEARCH': ws.send(JSON.stringify({ type: 'SEARCH_RESULTS', data: (stockCache.stocks||[]).filter(s => s.symbol.toLowerCase().includes((data.query||'').toLowerCase()) || s.name.toLowerCase().includes((data.query||'').toLowerCase())).slice(0, 20) })); break;
        case 'PING': ws.send(JSON.stringify({ type: 'PONG' })); break;
      }
    } catch (error) { console.error('WS error:', error); }
  });
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) { const msg = JSON.stringify(data); clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); }); }

// ============ DATA UPDATES ============
async function updateStocks() {
  if (!isLoggedIn) return;
  try {
    const data = await fetchAllStocks();
    if (data.stocks.length > 0) {
      stockCache = data;
      tradeJournal.updateTrades(stockCache.stocks);
      broadcast({ type: 'MARKET_UPDATE', data: data, timestamp: Date.now() });
      const now = new Date(); const minutes = now.getMinutes();
      if (minutes % 15 === 0 && stockCache.kse100) indexTrackerService.recordSnapshot(stockCache.kse100, null);
    }
  } catch (error) { if (error.response?.status === 401 || error.response?.status === 403) { isLoggedIn = false; broadcast({ type: 'LOGIN_EXPIRED' }); } }
}

// ============ REST API ============
app.post('/api/login', async (req, res) => { try { const token = await getToken(); if (token) { isLoggedIn = true; await updateStocks(); res.json({ success: true }); } else res.status(401).json({ success: false, error: 'Login failed' }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });
app.get('/api/status', (req, res) => res.json({ loggedIn: isLoggedIn, stockCount: stockCache.stocks?.length || 0, kse100: stockCache.kse100 || null }));
app.get('/api/stocks', (req, res) => { if (!isLoggedIn) return res.status(401).json({ error: 'Not logged in' }); res.json(stockCache); });
app.get('/api/stocks/:symbol', (req, res) => { const s = stockCache.stocks?.find(s => s.symbol === req.params.symbol.toUpperCase()); s ? res.json(s) : res.status(404).json({ error: 'Not found' }); });
app.get('/api/search', (req, res) => { res.json((stockCache.stocks||[]).filter(s => s.symbol.toLowerCase().includes((req.query.q||'').toLowerCase()) || s.name.toLowerCase().includes((req.query.q||'').toLowerCase())).slice(0, 20)); });
app.get('/api/orderbook/:symbol', async (req, res) => { if (!isLoggedIn) return res.status(401).json({ error: 'Not logged in' }); try { let ob = orderBookService.getCachedOrderBook(req.params.symbol); if (!ob) ob = await fetchOrderBookForSymbol(req.params.symbol); ob ? res.json(ob) : res.status(404).json({ error: 'Not available' }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/news/signal', async (req, res) => { try { res.json(await getQuickSignal()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/news/stock/:symbol', async (req, res) => { try { res.json(await getStockNews(req.params.symbol)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ============ STARTUP ============
async function start() {
  console.log('🔐 Testing authentication...');
  const authOk = await testLogin();
  if (authOk) {
    isLoggedIn = true;
    await updateStocks(); setInterval(updateStocks, UPDATE_INTERVAL);
    await fetchNewsAndBroadcast(); setInterval(fetchNewsAndBroadcast, NEWS_INTERVAL);
    await fetchAnnouncementsAndBroadcast(); setInterval(fetchAnnouncementsAndBroadcast, ANN_INTERVAL);
    setInterval(() => { if (stockCache.kse100) indexTrackerService.recordSnapshot(stockCache.kse100, null); }, INDEX_TRACKER_INTERVAL);
    setInterval(async () => { if (stockCache.stocks?.length > 0 && tradingSignalService.isMarketOpen()) { try { await orderFlowTracker.trackSymbols([], stockCache.stocks); } catch (e) {} } }, ORDERFLOW_TRACK_INTERVAL);
    setInterval(() => { if (stockCache.stocks?.length > 0) broadcast({ type: 'ORDERFLOW_SUMMARY', data: orderFlowTracker.getSummary() }); }, ORDERFLOW_BROADCAST_INTERVAL);
    setInterval(async () => { try { await globalIndicesService.fetchGlobalIndices(); } catch (e) {} }, GLOBAL_INDICES_INTERVAL);
    setInterval(async () => { if (stockCache.stocks?.length > 0 && tradingSignalService.isMarketOpen()) { try { const topStocks = stockCache.stocks.sort((a,b)=>b.volume-a.volume).slice(0,15); for (const stock of topStocks) { let ob = orderBookService.getCachedOrderBook(stock.symbol);
if (!ob) ob = await fetchOrderBookForSymbol(stock.symbol);
await institutionalTracker.analyzeStock(stock, ob); } const signals = institutionalTracker.getActiveSignals(60); if (signals.length > 0) broadcast({ type: 'INSTITUTIONAL_SIGNALS', data: { signals, alerts: institutionalTracker.getAlerts(5) } }); } catch (e) {} } }, INSTITUTIONAL_INTERVAL);

    // ─── NEW: Enhanced FIPI/LIPI with Mood broadcast every 5 min ───────
    setInterval(async () => {
        try {
            const fipiData = await getFipiLipData({ forceRefresh: true, stockData: stockCache.stocks });
            if (fipiData) {
                const marketIndex = stockCache.kse100 ? { changePercent: stockCache.kse100.changePercent } : null;
                const moodAnalysis = institutionalMoodService.analyzeMood(fipiData, stockCache.stocks || [], marketIndex);
                broadcast({ 
                    type: 'FIPILIPI_DATA', 
                    data: {
                        ...fipiData,
                        institutionalMood: moodAnalysis
                    }
                });
            }
        } catch (e) {}
    }, 300000);

    // ─── NEW: Full sector analysis with mood + rotation every 2 min ────
    setInterval(async () => {
        if (!isLoggedIn || !stockCache.stocks?.length) return;
        try {
            const analysis = await buildSectorAnalysis();
            broadcast({ 
                type: 'SECTORS_DATA', 
                data: { 
                    sectors: analysis.sectors,
                    institutionalMood: analysis.institutionalMood,
                    sectorRotation: analysis.sectorRotation,
                    signals: analysis.signals,
                    executiveSummary: analysis.executiveSummary
                }
            });
        } catch (e) {}
    }, 120000);

    console.log('✅ System ready (Smart Money v2)\n');
  }
  const PORT = process.env.PORT || 5001;
  server.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}\n`));
}
start();