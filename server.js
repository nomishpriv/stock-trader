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
const { getQuickSignal, getNewsImpact, getStockNews, TICKER_TO_SECTOR } = require('./services/newsService');

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
const NEWS_INTERVAL = 90000; // 90 seconds

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
        if (/R\d*$/.test(sym)) return false;
        if (s.nm && /right/i.test(s.nm)) return false;
        return true;
      })
      .map(([sym, s]) => ({
        symbol: sym,
        name: s.nm,
        price: +s.c,
        open: +s.o,
        high: +s.h,
        low: +s.l,
        volume: +s.v,
        change: +s.ch,
        changePercent: +((s.pch || 0) * 100).toFixed(2),
        rsi: +(s.rsi ?? 0),
        pivot: +(s.pp?.pp ?? 0),
        r1: +(s.pp?.r1 ?? 0),
        r2: +(s.pp?.r2 ?? 0),
        s1: +(s.pp?.s1 ?? 0),
        s2: +(s.pp?.s2 ?? 0),
        pe: +(s.pr ?? 0),
        eps: +(s.eps ?? 0),
        divYield: +(s.di ?? 0),
        bidPrice: s.bidp ? +s.bidp : 0,
        bidVolume: s.bidv ? +s.bidv : 0,
        askPrice: s.askp ? +s.askp : 0,
        askVolume: s.askv ? +s.askv : 0,
        upperCircuit: +s.uc,
        lowerCircuit: +s.lc,
        status: 'ACTIVE',
        lastUpdate: s.d,
        signal: calculateSignal(s)
      }));

    return {
      stocks,
      kse100: kseData ? {
        value: +kseData.c,
        change: +kseData.ch,
        changePercent: +((kseData.pch || 0) * 100).toFixed(2),
        volume: +kseData.v
      } : null
    };
  } catch (e) {
    console.error('Fetch error:', e.message);
    return { stocks: [], kse100: null };
  }
}

function calculateSignal(s) {
  const pch = s.pch || 0;
  const rsi = s.rsi || 50;
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
      params: { symbol: symbol.toUpperCase() },
      timeout: 8000
    });

    if (data?.data?.ob) {
      const orderBook = parseOrderBook(data.data);
      orderBookService.orderBooks.set(symbol.toUpperCase(), {
        ...orderBook,
        timestamp: Date.now()
      });
      return orderBook;
    }
    return null;
  } catch (error) {
    console.error(`Order book fetch error for ${symbol}:`, error.message);
    return null;
  }
}

function parseOrderBook(rawData) {
  const ob = rawData.ob;

  const bids = (ob.bl || []).map(level => ({
    price: level.x,
    volume: level.v,
    orders: level.on,
    level: level.lv
  }));

  const asks = (ob.sl || []).map(level => ({
    price: level.x,
    volume: level.v,
    orders: level.on,
    level: level.lv
  }));

  const totalBidVolume = bids.reduce((sum, b) => sum + b.volume, 0);
  const totalAskVolume = asks.reduce((sum, a) => sum + a.volume, 0);
  
  const bestBid = bids.length > 0 ? bids[0] : null;
  const bestAsk = asks.length > 0 ? asks[0] : null;
  
  const spread = bestBid && bestAsk ? bestAsk.price - bestBid.price : 0;
  const spreadPercent = bestBid ? (spread / bestBid.price) * 100 : 0;

  const bidAskRatio = totalAskVolume > 0 ? totalBidVolume / totalAskVolume : 0;
  
  let pressure = 'NEUTRAL';
  if (bidAskRatio > 1.5) pressure = 'STRONG_BUY';
  else if (bidAskRatio > 1.2) pressure = 'BUY';
  else if (bidAskRatio < 0.67) pressure = 'STRONG_SELL';
  else if (bidAskRatio < 0.83) pressure = 'SELL';

  const largeOrders = [];
  [...bids, ...asks].forEach(order => {
    if (order.volume > 5000) {
      largeOrders.push({
        type: bids.includes(order) ? 'BID' : 'ASK',
        price: order.price,
        volume: order.volume,
        impact: order.volume > 20000 ? 'HIGH' : order.volume > 10000 ? 'MEDIUM' : 'LOW'
      });
    }
  });

  const strongSupport = bids.length > 0 ? 
    bids.reduce((max, b) => b.volume > max.volume ? b : max, bids[0]) : null;
  
  const strongResistance = asks.length > 0 ? 
    asks.reduce((max, a) => a.volume > max.volume ? a : max, asks[0]) : null;

  return {
    symbol: ob.s,
    market: ob.m,
    timestamp: ob.t,
    bestBid: bestBid?.price || 0,
    bestAsk: bestAsk?.price || 0,
    spread: +spread.toFixed(2),
    spreadPercent: +spreadPercent.toFixed(2),
    totalBidVolume,
    totalAskVolume,
    bidAskRatio: +bidAskRatio.toFixed(2),
    pressure,
    bids: bids.slice(0, 10),
    asks: asks.slice(0, 10),
    bidSummary: ob.bs || { x: 0, v: 0 },
    askSummary: ob.ss || { x: 0, v: 0 },
    top3BidVol: bids.slice(0, 3).reduce((s, b) => s + b.volume, 0),
    top3AskVol: asks.slice(0, 3).reduce((s, a) => s + a.volume, 0),
    largeOrders,
    support: bestBid?.price || 0,
    resistance: bestAsk?.price || 0,
    strongSupport: strongSupport ? { price: strongSupport.price, volume: strongSupport.volume } : null,
    strongResistance: strongResistance ? { price: strongResistance.price, volume: strongResistance.volume } : null,
    imbalance: +((totalBidVolume - totalAskVolume) / (totalBidVolume + totalAskVolume || 1) * 100).toFixed(1)
  };
}

// ============ NEWS HELPERS ============
function findSectorForStock(symbol) {
  return TICKER_TO_SECTOR[symbol.toUpperCase()] || null;
}

async function fetchNewsAndBroadcast() {
  try {
    const signal = await getQuickSignal();
    if (signal) {
      broadcast({ type: 'NEWS_SIGNAL', data: signal });
      console.log(`📰 News: ${signal.emoji} ${signal.signal} (${signal.confidence}% confidence)`);
    }
  } catch (e) {
    // Silent fail for news
  }
}

// ============ WEBSOCKET ============
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`📱 Client connected (Total: ${clients.size})`);

  ws.send(JSON.stringify({
    type: 'LOGIN_STATUS',
    loggedIn: isLoggedIn
  }));

  if (stockCache.stocks && stockCache.stocks.length > 0) {
    ws.send(JSON.stringify({
      type: 'MARKET_DATA',
      data: stockCache
    }));
  }

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      switch(data.type) {
        case 'LOGIN':
          console.log('🔐 Login requested by client');
          const token = await getToken();
          if (token) {
            isLoggedIn = true;
            ws.send(JSON.stringify({ type: 'LOGIN_SUCCESS' }));
            broadcast({ type: 'LOGIN_STATUS', loggedIn: true });
            await updateStocks();
            // Fetch news after login
            fetchNewsAndBroadcast();
          } else {
            ws.send(JSON.stringify({ 
              type: 'LOGIN_ERROR', 
              message: 'Login failed. Check credentials in .env file.' 
            }));
          }
          break;

        case 'GET_STOCK':
          const stock = stockCache.stocks?.find(s => s.symbol === data.symbol?.toUpperCase());
          ws.send(JSON.stringify({
            type: 'STOCK_DETAIL',
            data: stock || null
          }));
          break;

        case 'GET_ORDERBOOK':
          if (data.symbol) {
            try {
              let orderBook = orderBookService.getCachedOrderBook(data.symbol);
              if (!orderBook) {
                orderBook = await fetchOrderBookForSymbol(data.symbol);
              }
              ws.send(JSON.stringify({
                type: 'ORDERBOOK_UPDATE',
                data: orderBook
              }));
            } catch (error) {
              ws.send(JSON.stringify({
                type: 'ORDERBOOK_ERROR',
                symbol: data.symbol,
                message: error.message
              }));
            }
          }
          break;

        case 'SUBSCRIBE_ORDERBOOK':
          if (data.symbol) {
            ws.subscribedOrderBook = data.symbol;
            const orderBook = await fetchOrderBookForSymbol(data.symbol);
            if (orderBook) {
              ws.send(JSON.stringify({
                type: 'ORDERBOOK_UPDATE',
                data: orderBook
              }));
            }
          }
          break;

        case 'GET_NEWS_SIGNAL':
          try {
            const quickSignal = await getQuickSignal();
            ws.send(JSON.stringify({ type: 'NEWS_SIGNAL', data: quickSignal }));
          } catch (e) {
            ws.send(JSON.stringify({ type: 'NEWS_SIGNAL', data: null }));
          }
          break;

        case 'GET_STOCK_NEWS':
          if (data.symbol) {
            try {
              const stockNews = await getStockNews(data.symbol);
              ws.send(JSON.stringify({ 
                type: 'STOCK_NEWS', 
                symbol: data.symbol, 
                data: stockNews 
              }));
            } catch (e) {
              ws.send(JSON.stringify({ 
                type: 'STOCK_NEWS', 
                symbol: data.symbol, 
                data: null 
              }));
            }
          }
          break;

        case 'SEARCH':
          const query = data.query?.toLowerCase() || '';
          const results = stockCache.stocks?.filter(s => 
            s.symbol.toLowerCase().includes(query) || 
            s.name.toLowerCase().includes(query)
          ).slice(0, 20) || [];
          ws.send(JSON.stringify({
            type: 'SEARCH_RESULTS',
            data: results
          }));
          break;

        case 'PING':
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;
      }
    } catch (error) {
      console.error('WS error:', error);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`📱 Client disconnected (Total: ${clients.size})`);
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ============ DATA UPDATES ============
async function updateStocks() {
  if (!isLoggedIn) return;
  
  try {
    const data = await fetchAllStocks();
    if (data.stocks.length > 0) {
      stockCache = data;
      broadcast({
        type: 'MARKET_UPDATE',
        data: data,
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.error('Update error:', error.message);
    if (error.response?.status === 401 || error.response?.status === 403) {
      isLoggedIn = false;
      broadcast({ type: 'LOGIN_EXPIRED' });
    }
  }
}

// ============ REST API ============
app.post('/api/login', async (req, res) => {
  try {
    const token = await getToken();
    if (token) {
      isLoggedIn = true;
      await updateStocks();
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, error: 'Login failed' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({ 
    loggedIn: isLoggedIn, 
    stockCount: stockCache.stocks?.length || 0,
    kse100: stockCache.kse100 || null
  });
});

app.get('/api/stocks', async (req, res) => {
  if (!isLoggedIn) return res.status(401).json({ error: 'Not logged in' });
  res.json(stockCache);
});

app.get('/api/stocks/:symbol', (req, res) => {
  const stock = stockCache.stocks?.find(s => s.symbol === req.params.symbol.toUpperCase());
  if (stock) res.json(stock);
  else res.status(404).json({ error: 'Not found' });
});

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const results = stockCache.stocks?.filter(s => 
    s.symbol.toLowerCase().includes(q) || 
    s.name.toLowerCase().includes(q)
  ).slice(0, 20) || [];
  res.json(results);
});

app.get('/api/orderbook/:symbol', async (req, res) => {
  if (!isLoggedIn) return res.status(401).json({ error: 'Not logged in' });
  
  try {
    let orderBook = orderBookService.getCachedOrderBook(req.params.symbol);
    if (!orderBook) {
      orderBook = await fetchOrderBookForSymbol(req.params.symbol);
    }
    if (orderBook) res.json(orderBook);
    else res.status(404).json({ error: 'Order book not available' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// News API endpoints
app.get('/api/news/signal', async (req, res) => {
  try {
    const signal = await getQuickSignal();
    res.json(signal);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/news/stock/:symbol', async (req, res) => {
  try {
    const news = await getStockNews(req.params.symbol);
    res.json(news);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ STARTUP ============
async function start() {
  if (!process.env.STOCKINTEL_PHONE || !process.env.STOCKINTEL_PASSWORD) {
    console.log('\n⚠️  WARNING: Environment variables not set!');
    console.log('   Create a .env file with:');
    console.log('   STOCKINTEL_PHONE=your_phone');
    console.log('   STOCKINTEL_PASSWORD=your_password');
    console.log('   DEVICE_ID=your_device_id\n');
  }

  console.log('🔐 Testing authentication...');
  const authOk = await testLogin();
  
  if (authOk) {
    isLoggedIn = true;
    console.log('📡 Fetching initial data...');
    await updateStocks();
    
    // Stock updates every 3 seconds
    setInterval(updateStocks, UPDATE_INTERVAL);
    
    // News updates every 90 seconds
    console.log('📰 Fetching initial news...');
    await fetchNewsAndBroadcast();
    setInterval(fetchNewsAndBroadcast, NEWS_INTERVAL);
    
    console.log('✅ System ready\n');
  } else {
    console.log('⚠️  Login failed. Will retry when client requests login.\n');
  }

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📱 Open this URL on your phone\n`);
  });
}

start();