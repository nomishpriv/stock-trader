# Stock Trader Pro - Backend AI Context

## Server Overview
Node.js + Express + WebSocket server for real-time PSX (Pakistan Stock Exchange) market data.
Single file: `server.js` with modular service imports from `./services/` directory.

## Tech Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Real-time**: WebSocket (`ws` library)
- **Auth**: Token-based via `authService.js`
- **Data Source**: External PSX API (proxied through `api` axios instance)

## Architecture

### Server Initialization Flow

start()
→ testLogin() // Authenticate with PSX API
→ updateStocks() // Initial market data fetch
→ setInterval(updateStocks, 3s) // Continuous polling
→ setInterval(news, 90s) // News polling
→ setInterval(announcements, 5m) // Announcements polling
→ setInterval(indexTracker, 15m) // Index snapshots
→ setInterval(orderFlow, 2m) // Order flow tracking
→ setInterval(institutional, 45s)// Smart money detection
→ setInterval(fipiLipi, 5m) // FIPI/LIPI data
→ setInterval(sectors, 2m) // Sector analysis broadcast
→ listen(PORT)


### Data Flow Pattern

PSX API → server.js → stockCache (server memory)
↓
WebSocket broadcast to all clients
↓
Client receives MARKET_UPDATE


## Key Variables & State

```javascript
// Server state
let isLoggedIn = false;           // Auth status
let stockCache = [];              // { stocks: [], kse100: {} }
let clients = new Set();          // Connected WebSocket clients

// Polling intervals (milliseconds)
UPDATE_INTERVAL = 3000            // Market data: every 3s
NEWS_INTERVAL = 90000             // News signal: every 90s
ANN_INTERVAL = 300000             // Announcements: every 5min
INDEX_TRACKER_INTERVAL = 900000   // Index snapshots: every 15min
ORDERFLOW_TRACK_INTERVAL = 120000 // Order flow scan: every 2min
ORDERFLOW_BROADCAST_INTERVAL = 30000  // Flow summary: every 30s
GLOBAL_INDICES_INTERVAL = 300000  // Global indices: every 5min
INSTITUTIONAL_INTERVAL = 45000    // Institutional scan: every 45s

WebSocket Message Protocol
Client → Server (Requests)
Message Type	Purpose	Payload
LOGIN	Authenticate	{}
GET_STOCK	Get single stock	{ symbol: "HUBC" }
GET_ORDERBOOK	Get order book	{ symbol: "HUBC" }
GET_NEWS_SIGNAL	AI news signal	{}
GET_STOCK_NEWS	Stock-specific news	{ symbol: "HUBC" }
GET_NEWS_TICKER	News headlines	{}
GET_ANNOUNCEMENTS	All announcements	{}
GET_STOCK_ANNOUNCEMENT	Stock announcement	{ symbol: "HUBC" }
GET_TRADING_SIGNALS	AI trading signals	{}
ANALYZE_PREMARKET	Pre-market scan	{}
GET_INDEX_TRACKER	KSE-100 tracker	{}
GET_ORDERFLOW	Order flow data	{}
GET_GLOBAL_INDICES	World indices	{}
ANALYZE_INSTITUTIONAL	Scan for whales	{}
GET_INSTITUTIONAL_SIGNALS	Cached signals	{}
GET_STOCK_INSTITUTIONAL	Stock history	{ symbol: "HUBC" }
GET_SECTOR_STOCKS	Stocks in sector	{ sector: "Cement" }
GET_FIPILIPI	FIPI/LIPI data	{}
GET_FIPILIPI_WEEKLY	Weekly trend	{}
GET_SECTORS	Sector analysis	{}
GET_TRADES	Trade journal	{}
OPEN_TRADE	Open new trade	{ symbol, entryPrice, quantity, ... }
CLOSE_TRADE	Close trade	{ tradeId, exitPrice, reason }
AVERAGE_DOWN	Average down	{ tradeId, quantity, price }
TAKE_TRADE_FROM_SIGNAL	From signal tab	{ signal: {...}, quantity }
SEARCH	Symbol search	{ query: "hub" }
PING	Keepalive	{}

Server → Client (Responses)
Message Type	Sent Via	Description
LOGIN_STATUS	Direct + Broadcast	Auth state
LOGIN_SUCCESS	Direct	Login OK
LOGIN_ERROR	Direct	Login failed
LOGIN_EXPIRED	Broadcast	Session expired
MARKET_UPDATE	Broadcast (every 3s)	Full market data
ORDERBOOK_UPDATE	Direct	Single stock order book
ORDERBOOK_ERROR	Direct	Order book fetch failed
NEWS_SIGNAL	Broadcast	AI news sentiment
NEWS_TICKER	Direct	News headlines
STOCK_NEWS	Direct	Stock-specific news
ANNOUNCEMENTS	Broadcast	All announcements
STOCK_ANNOUNCEMENT	Direct	Single stock announcement
TRADING_SIGNALS	Direct	AI trading signals
PREMARKET_ANALYSIS	Direct	Pre-market scan results
INDEX_TRACKER	Direct	KSE-100 history
ORDERFLOW	Direct	Order flow data
ORDERFLOW_SUMMARY	Broadcast	Flow summary
GLOBAL_INDICES	Direct	World indices
INSTITUTIONAL_SIGNALS	Direct + Broadcast	Whale signals
TRADES_DATA	Direct	Trade journal data
TRADE_OPENED	Direct	Confirmation
TRADE_CLOSED	Direct	Confirmation
TRADE_AVERAGED	Direct	Confirmation
TRADE_ERROR	Direct	Error message
SECTOR_STOCKS	Direct	Stocks in sector
FIPILIPI_DATA	Direct + Broadcast	FIPI/LIPI data
SECTORS_DATA	Direct + Broadcast	Sector analysis
FIPILIPI_WEEKLY	Direct	Weekly trend
SEARCH_RESULTS	Direct	Search results
PONG	Direct	Keepalive response

Service Modules

services/
├── authService.js          → { api, getToken(), testLogin() }
├── orderBookService.js     → { orderBooks: Map, getCachedOrderBook() }
├── newsService.js          → { getQuickSignal(), getStockNews(), getNewsTicker(), TICKER_TO_SECTOR }
├── announcementService.js  → { getAnnouncements(), getStockAnnouncement() }
├── tradingSignalService.js → { generateSignals(), analyzePreMarket(), isMarketOpen() }
├── indexTrackerService.js  → { recordSnapshot(), getTrackerData() }
├── orderFlowTrackerService.js → { trackSymbols(), getData(), getSummary(), getTopStocks(), getHourlyFlow(), getLargeTrades() }
├── institutionalTrackerService.js → { analyzeStock(), getActiveSignals(), getAlerts(), getStockHistory() }
├── tradeJournalService.js  → { openTrade(), closeTrade(), averageDown(), getAllTrades(), updateTrades() }
├── globalIndicesService.js → { fetchGlobalIndices() }
├── fipiLipService.js       → { getFipiLipData(), getWeeklyTrend() }
├── sectorMappingService.js → { getSectorForSymbol(), getStocksForSector(), getAllSectors() }
└── sectorAnalysisService.js → { analyze() }

Key Functions

fetchAllStocks()
Fetches market data from PSX API, filters out:

Zero/negative price stocks

Penny stocks (price < 2 AND volume < 10000)

Rights issues (name contains "right", symbol ends with R+digits)

Suspended stocks (st === 2)

Zero shares outstanding

Zero volume stocks

Returns: { stocks: [...], kse100: { value, change, changePercent, volume, high, low } }

calculateSignal(s)
Basic signal based on price change and RSI:

pch > 0.01 → +1, pch < -0.01 → -1

RSI < 40 → +1, RSI > 60 → -1

Score ≥ 2 → STRONG_BUY, 1 → BUY, -1 → SELL, ≤ -2 → STRONG_SELL

parseOrderBook(rawData)
Parses raw order book into structured format with:

bids/asks arrays (price, volume, orders, level)

bestBid, bestAsk, spread, spreadPercent

bidAskRatio, pressure (STRONG_BUY/SELL etc.)

largeOrders (>5000 volume)

support/resistance levels

imbalance percentage

detectOrderBookTraps(parsedBook, stockData)
Sophisticated trap detection:

Liquidity Analysis - wide spreads, shallow books, thin volume

Fake Wall Detection - concentrated orders at one level, circuit-limit walls, round-number manipulation

Spoofing Indicators - extreme ratios + wide spreads, top-heavy books, price/imbalance divergence

Signal Adjustment - downgrades/upgrades based on trap findings

Returns: { confidence, isFakeWall, isSpoofing, isLowLiquidity, warnings[], realSignal }

broadcast(data)
Sends JSON message to all connected WebSocket clients.

Adding a New Feature
Step 1: Create service (if needed)
javascript
// services/newFeatureService.js
class NewFeatureService {
    getData() { ... }
}
module.exports = new NewFeatureService();
Step 2: Add to server.js
javascript
// Import
const newFeatureService = require('./services/newFeatureService');

// Add interval (if polling needed)
const NEW_FEATURE_INTERVAL = 60000;
setInterval(async () => {
    if (!isLoggedIn || !stockCache.stocks?.length) return;
    try {
        const data = await newFeatureService.getData();
        broadcast({ type: 'NEW_FEATURE_DATA', data });
    } catch (e) {}
}, NEW_FEATURE_INTERVAL);

// Add WebSocket handler
case 'GET_NEW_FEATURE':
    try {
        const data = await newFeatureService.getData();
        ws.send(JSON.stringify({ type: 'NEW_FEATURE_DATA', data }));
    } catch (e) {
        ws.send(JSON.stringify({ type: 'NEW_FEATURE_DATA', data: null }));
    }
    break;
Step 3: Update AI_CONTEXT.md (frontend) for the new tab
REST API Endpoints
text
POST /api/login              → Login
GET  /api/status             → { loggedIn, stockCount, kse100 }
GET  /api/stocks             → All stocks (requires auth)
GET  /api/stocks/:symbol     → Single stock
GET  /api/search?q=HUBC      → Search stocks
GET  /api/orderbook/:symbol  → Order book
GET  /api/news/signal        → AI news signal
GET  /api/news/stock/:symbol → Stock news
GET  *                       → Serves index.html (SPA fallback)
Common Patterns
Direct Response (one client)
javascript
case 'GET_SOMETHING':
    try {
        const data = await someService.getData();
        ws.send(JSON.stringify({ type: 'SOMETHING_DATA', data }));
    } catch (e) {
        ws.send(JSON.stringify({ type: 'SOMETHING_DATA', data: null }));
    }
    break;
Broadcast (all clients)
javascript
async function fetchAndBroadcast() {
    try {
        const data = await someService.getData();
        if (data) broadcast({ type: 'SOMETHING_UPDATE', data });
    } catch (e) {}
}
Polling Interval
javascript
const INTERVAL = 60000; // milliseconds
setInterval(async () => {
    if (!isLoggedIn || !stockCache.stocks?.length) return;
    try {
        // fetch and broadcast
    } catch (e) {}
}, INTERVAL);
Error Handling
Auth failures (401/403) → set isLoggedIn = false, broadcast LOGIN_EXPIRED

Service errors → send null data or empty arrays

Always wrap in try/catch to prevent server crashes

Example AI Prompt
text
Modify server.js to add a new "Market Breadth" feature:

1. Create services/marketBreadthService.js that calculates:
   - Advances/Declines ratio
   - New highs/lows count
   - Volume ratio (up volume vs down volume)

2. Add to server.js:
   - Import service
   - Add 60s polling interval
   - Add 'GET_MARKET_BREADTH' WebSocket handler
   - Broadcast every 60s as 'MARKET_BREADTH_UPDATE'

3. Frontend already has a tab ready (provided in AI_CONTEXT.md)
text

---

This context document covers everything an AI needs to understand the server architecture and make targeted modifications. When you need changes, just paste this along with your specific request.