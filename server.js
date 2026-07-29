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
const ORDERFLOW_TRACK_INTERVAL = 120000; // 2 minutes
const ORDERFLOW_BROADCAST_INTERVAL = 30000; // 30 seconds

// ============ FETCH MARKET DATA ============
async function fetchMarketData() {
  try {
    const { data } = await api.get('/market');
    return data;
  } catch (e) {
    throw e;
  }
}

async function fetchAllStocks() {
  try {
    const data = await fetchMarketData();
    const raw = data?.data?.eq;
    if (!raw) return [];

    const kseData = data?.data?.in?.KSE100;

    const stocks = Object.entries(raw)
      .filter(([sym, s]) => {
        if (!s.c || +s.c <= 0) return false;
        if (s.nm) {
          const name = s.nm.toLowerCase();
          if (name.includes('(right)') || name.includes('(r)') || name.endsWith(' right') || 
              name.includes('right)') || name.includes(' right ') || (name.startsWith('right') && name.length < 20)) {
            return false;
          }
        }
        if (/R\d+$/.test(sym)) return false;
        if (s.st === 2) return false;
        if (!s.sh || +s.sh === 0) return false;
        if (!s.nm || s.nm.trim() === '') return false;
        return true;
      })
      .map(([sym, s]) => ({
        symbol: sym, name: s.nm, price: +s.c, open: +s.o, high: +s.h, low: +s.l,
        volume: +s.v, change: +s.ch, changePercent: +((s.pch || 0) * 100).toFixed(2),
        rsi: +(s.rsi ?? 0), pivot: +(s.pp?.pp ?? 0), r1: +(s.pp?.r1 ?? 0), r2: +(s.pp?.r2 ?? 0),
        s1: +(s.pp?.s1 ?? 0), s2: +(s.pp?.s2 ?? 0), pe: +(s.pr ?? 0), eps: +(s.eps ?? 0),
        divYield: +(s.di ?? 0), bidPrice: s.bidp ? +s.bidp : 0, bidVolume: s.bidv ? +s.bidv : 0,
        askPrice: s.askp ? +s.askp : 0, askVolume: s.askv ? +s.askv : 0,
        upperCircuit: +s.uc, lowerCircuit: +s.lc, status: 'ACTIVE', lastUpdate: s.d,
        signal: calculateSignal(s)
      }));

    console.log(`📊 Stocks: ${stocks.length} loaded`);

    return {
      stocks,
      kse100: kseData ? {
        value: +kseData.c, change: +kseData.ch,
        changePercent: +((kseData.pch || 0) * 100).toFixed(2), volume: +kseData.v,
        high: +kseData.h, low: +kseData.l
      } : null
    };
  } catch (e) {
    console.error('Fetch error:', e.message);
    return { stocks: [], kse100: null };
  }
}

function calculateSignal(s) {
  const pch = s.pch || 0, rsi = s.rsi || 50;
  let score = 0;
  if (pch > 0.01) score++;
  if (pch < -0.01) score--;
  if (rsi < 40) score++;
  if (rsi > 60) score--;
  if (score >= 2) return 'STRONG_BUY';
  if (score === 1) return 'BUY';
  if (score === -1) return 'SELL';
  if (score <= -2) return 'STRONG_SELL';
  return 'NEUTRAL';
}

// ============ ORDER BOOK FUNCTIONS ============
async function fetchOrderBookForSymbol(symbol) {
  try {
    const { data } = await api.get('/trading/subscribe', {
      params: { symbol: symbol.toUpperCase() }, timeout: 8000
    });
    if (data?.data?.ob) {
      const orderBook = parseOrderBook(data.data);
      orderBookService.orderBooks.set(symbol.toUpperCase(), { ...orderBook, timestamp: Date.now() });
      return orderBook;
    }
    return null;
  } catch (error) { return null; }
}

function parseOrderBook(rawData) {
  const ob = rawData.ob;
  const bids = (ob.bl || []).map(l => ({ price: l.x, volume: l.v, orders: l.on, level: l.lv }));
  const asks = (ob.sl || []).map(l => ({ price: l.x, volume: l.v, orders: l.on, level: l.lv }));
  const totalBidVolume = bids.reduce((s, b) => s + b.volume, 0);
  const totalAskVolume = asks.reduce((s, a) => s + a.volume, 0);
  const bestBid = bids[0] || null, bestAsk = asks[0] || null;
  const spread = bestBid && bestAsk ? bestAsk.price - bestBid.price : 0;
  const spreadPercent = bestBid ? (spread / bestBid.price) * 100 : 0;
  const bidAskRatio = totalAskVolume > 0 ? totalBidVolume / totalAskVolume : 0;
  let pressure = 'NEUTRAL';
  if (bidAskRatio > 1.5) pressure = 'STRONG_BUY';
  else if (bidAskRatio > 1.2) pressure = 'BUY';
  else if (bidAskRatio < 0.67) pressure = 'STRONG_SELL';
  else if (bidAskRatio < 0.83) pressure = 'SELL';

  const largeOrders = [];
  [...bids, ...asks].forEach(o => {
    if (o.volume > 5000) largeOrders.push({
      type: bids.includes(o) ? 'BID' : 'ASK', price: o.price, volume: o.volume,
      impact: o.volume > 20000 ? 'HIGH' : o.volume > 10000 ? 'MEDIUM' : 'LOW'
    });
  });

  const strongSupport = bids.length ? bids.reduce((max, b) => b.volume > max.volume ? b : max, bids[0]) : null;
  const strongResistance = asks.length ? asks.reduce((max, a) => a.volume > max.volume ? a : max, asks[0]) : null;

  return {
    symbol: ob.s, market: ob.m, timestamp: ob.t,
    bestBid: bestBid?.price || 0, bestAsk: bestAsk?.price || 0,
    spread: +spread.toFixed(2), spreadPercent: +spreadPercent.toFixed(2),
    totalBidVolume, totalAskVolume, bidAskRatio: +bidAskRatio.toFixed(2), pressure,
    bids: bids.slice(0, 10), asks: asks.slice(0, 10),
    bidSummary: ob.bs || { x: 0, v: 0 }, askSummary: ob.ss || { x: 0, v: 0 },
    top3BidVol: bids.slice(0, 3).reduce((s, b) => s + b.volume, 0),
    top3AskVol: asks.slice(0, 3).reduce((s, a) => s + a.volume, 0),
    largeOrders, support: bestBid?.price || 0, resistance: bestAsk?.price || 0,
    strongSupport: strongSupport ? { price: strongSupport.price, volume: strongSupport.volume } : null,
    strongResistance: strongResistance ? { price: strongResistance.price, volume: strongResistance.volume } : null,
    imbalance: +((totalBidVolume - totalAskVolume) / (totalBidVolume + totalAskVolume || 1) * 100).toFixed(1)
  };
}

// ============ HELPERS ============
function findSectorForStock(symbol) { return TICKER_TO_SECTOR[symbol.toUpperCase()] || null; }

async function fetchNewsAndBroadcast() {
  try { const s = await getQuickSignal(); if (s) broadcast({ type: 'NEWS_SIGNAL', data: s }); } catch (e) {}
}

async function fetchAnnouncementsAndBroadcast() {
  try { const a = await getQuickAnnouncements(); if (a) broadcast({ type: 'ANNOUNCEMENTS', data: a }); } catch (e) {}
}

// ============ WEBSOCKET ============
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'LOGIN_STATUS', loggedIn: isLoggedIn }));
  if (stockCache.stocks?.length) ws.send(JSON.stringify({ type: 'MARKET_DATA', data: stockCache }));

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      switch(data.type) {
        case 'LOGIN':
          const token = await getToken();
          if (token) {
            isLoggedIn = true;
            ws.send(JSON.stringify({ type: 'LOGIN_SUCCESS' }));
            broadcast({ type: 'LOGIN_STATUS', loggedIn: true });
            await updateStocks();
            fetchNewsAndBroadcast();
            fetchAnnouncementsAndBroadcast();
          } else ws.send(JSON.stringify({ type: 'LOGIN_ERROR', message: 'Login failed' }));
          break;

        case 'GET_STOCK':
          const stock = stockCache.stocks?.find(s => s.symbol === data.symbol?.toUpperCase());
          ws.send(JSON.stringify({ type: 'STOCK_DETAIL', data: stock || null }));
          break;

        case 'GET_ORDERBOOK':
          if (data.symbol) {
            try {
              let ob = orderBookService.getCachedOrderBook(data.symbol);
              if (!ob) ob = await fetchOrderBookForSymbol(data.symbol);
              ws.send(JSON.stringify({ type: 'ORDERBOOK_UPDATE', data: ob }));
            } catch (e) { ws.send(JSON.stringify({ type: 'ORDERBOOK_ERROR', symbol: data.symbol, message: e.message })); }
          }
          break;

        case 'GET_NEWS_SIGNAL':
          try { ws.send(JSON.stringify({ type: 'NEWS_SIGNAL', data: await getQuickSignal() })); } catch (e) { ws.send(JSON.stringify({ type: 'NEWS_SIGNAL', data: null })); }
          break;

        case 'GET_STOCK_NEWS':
          if (data.symbol) {
            try { ws.send(JSON.stringify({ type: 'STOCK_NEWS', symbol: data.symbol, data: await getStockNews(data.symbol) })); }
            catch (e) { ws.send(JSON.stringify({ type: 'STOCK_NEWS', symbol: data.symbol, data: null })); }
          }
          break;

        case 'GET_NEWS_TICKER':
          try { ws.send(JSON.stringify({ type: 'NEWS_TICKER', data: await getNewsTicker() })); } catch (e) { ws.send(JSON.stringify({ type: 'NEWS_TICKER', data: [] })); }
          break;

        case 'GET_ANNOUNCEMENTS':
          try { ws.send(JSON.stringify({ type: 'ANNOUNCEMENTS', data: await getQuickAnnouncements() })); } catch (e) { ws.send(JSON.stringify({ type: 'ANNOUNCEMENTS', data: null })); }
          break;

        case 'GET_STOCK_ANNOUNCEMENT':
          if (data.symbol) {
            try { ws.send(JSON.stringify({ type: 'STOCK_ANNOUNCEMENT', symbol: data.symbol, data: await getStockAnnouncement(data.symbol) })); }
            catch (e) { ws.send(JSON.stringify({ type: 'STOCK_ANNOUNCEMENT', symbol: data.symbol, data: null })); }
          }
          break;

        case 'GET_TRADING_SIGNALS':
          try {
            const newsSignal = await getQuickSignal();
            const announcements = await getAnnouncements();
            const signals = tradingSignalService.generateSignals(stockCache.stocks || [], newsSignal, announcements);
            ws.send(JSON.stringify({ type: 'TRADING_SIGNALS', data: signals }));
          } catch (e) { ws.send(JSON.stringify({ type: 'TRADING_SIGNALS', data: [] })); }
          break;

        case 'GET_PREMARKET':
          try {
            const preMarket = await tradingSignalService.analyzePreMarket(stockCache.stocks || [], orderBookService);
            ws.send(JSON.stringify({ type: 'PREMARKET', data: preMarket }));
          } catch (e) { ws.send(JSON.stringify({ type: 'PREMARKET', data: [] })); }
          break;

        case 'ANALYZE_PREMARKET':
          try {
            const preMarketAnalysis = await tradingSignalService.analyzePreMarketSession(
              stockCache.stocks || [], orderBookService
            );
            ws.send(JSON.stringify({ type: 'PREMARKET_ANALYSIS', data: preMarketAnalysis }));
          } catch (e) {
            ws.send(JSON.stringify({ type: 'PREMARKET_ANALYSIS', data: { isPreMarket: false, message: 'Analysis failed', signals: [] } }));
          }
          break;

        case 'GET_INDEX_TRACKER':
          try {
            const trackerData = indexTrackerService.getTrackerData();
            ws.send(JSON.stringify({ type: 'INDEX_TRACKER', data: trackerData }));
          } catch (e) { ws.send(JSON.stringify({ type: 'INDEX_TRACKER', data: null })); }
          break;

        case 'GET_ORDERFLOW':
          try {
            const flowData = orderFlowTracker.getData();
            const topStocks = orderFlowTracker.getTopStocks(15);
            const hourlyFlow = orderFlowTracker.getHourlyFlow();
            const largeTrades = orderFlowTracker.getLargeTrades(20);
            ws.send(JSON.stringify({ 
              type: 'ORDERFLOW', 
              data: { summary: flowData.summary, remarks: flowData.remarks, topStocks, hourlyFlow, largeTrades }
            }));
          } catch (e) { ws.send(JSON.stringify({ type: 'ORDERFLOW', data: null })); }
          break;

        case 'SEARCH':
          const q = (data.query || '').toLowerCase();
          const results = (stockCache.stocks || []).filter(s => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 20);
          ws.send(JSON.stringify({ type: 'SEARCH_RESULTS', data: results }));
          break;

        case 'PING': ws.send(JSON.stringify({ type: 'PONG' })); break;
      }
    } catch (error) { console.error('WS error:', error); }
  });

  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// ============ DATA UPDATES ============
async function updateStocks() {
  if (!isLoggedIn) return;
  try {
    const data = await fetchAllStocks();
    if (data.stocks.length > 0) {
      stockCache = data;
      broadcast({ type: 'MARKET_UPDATE', data: data, timestamp: Date.now() });
      
      const now = new Date();
      const minutes = now.getMinutes();
      if (minutes % 15 === 0 && stockCache.kse100) {
        indexTrackerService.recordSnapshot(stockCache.kse100, null);
      }
    }
  } catch (error) {
    if (error.response?.status === 401 || error.response?.status === 403) {
      isLoggedIn = false; broadcast({ type: 'LOGIN_EXPIRED' });
    }
  }
}

// ============ REST API ============
app.post('/api/login', async (req, res) => {
  try {
    const token = await getToken();
    if (token) { isLoggedIn = true; await updateStocks(); res.json({ success: true }); }
    else res.status(401).json({ success: false, error: 'Login failed' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/status', (req, res) => res.json({ loggedIn: isLoggedIn, stockCount: stockCache.stocks?.length || 0, kse100: stockCache.kse100 || null }));
app.get('/api/stocks', (req, res) => { if (!isLoggedIn) return res.status(401).json({ error: 'Not logged in' }); res.json(stockCache); });
app.get('/api/stocks/:symbol', (req, res) => {
  const stock = stockCache.stocks?.find(s => s.symbol === req.params.symbol.toUpperCase());
  stock ? res.json(stock) : res.status(404).json({ error: 'Not found' });
});
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  res.json((stockCache.stocks || []).filter(s => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 20));
});
app.get('/api/orderbook/:symbol', async (req, res) => {
  if (!isLoggedIn) return res.status(401).json({ error: 'Not logged in' });
  try {
    let ob = orderBookService.getCachedOrderBook(req.params.symbol);
    if (!ob) ob = await fetchOrderBookForSymbol(req.params.symbol);
    ob ? res.json(ob) : res.status(404).json({ error: 'Not available' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/news/signal', async (req, res) => { try { res.json(await getQuickSignal()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/news/stock/:symbol', async (req, res) => { try { res.json(await getStockNews(req.params.symbol)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ============ STARTUP ============
async function start() {
  console.log('🔐 Testing authentication...');
  const authOk = await testLogin();
  if (authOk) {
    isLoggedIn = true;
    await updateStocks();
    setInterval(updateStocks, UPDATE_INTERVAL);
    await fetchNewsAndBroadcast();
    setInterval(fetchNewsAndBroadcast, NEWS_INTERVAL);
    await fetchAnnouncementsAndBroadcast();
    setInterval(fetchAnnouncementsAndBroadcast, ANN_INTERVAL);
    
    setInterval(() => {
      if (stockCache.kse100) indexTrackerService.recordSnapshot(stockCache.kse100, null);
    }, INDEX_TRACKER_INTERVAL);
    
    // Order flow tracking every 2 minutes during market hours
    setInterval(async () => {
      if (stockCache.stocks?.length > 0 && tradingSignalService.isMarketOpen()) {
        try { await orderFlowTracker.trackSymbols([], stockCache.stocks); } catch (e) {}
      }
    }, ORDERFLOW_TRACK_INTERVAL);
    
    // Broadcast order flow summary every 30 seconds
    setInterval(() => {
      if (stockCache.stocks?.length > 0) {
        const summary = orderFlowTracker.getSummary();
        broadcast({ type: 'ORDERFLOW_SUMMARY', data: summary });
      }
    }, ORDERFLOW_BROADCAST_INTERVAL);
    
    console.log('✅ System ready\n');
  }
  const PORT = process.env.PORT || 5001;
  server.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}\n`));
}

start();