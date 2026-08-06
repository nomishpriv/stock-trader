# Stock Trader Pro - AI Context

## Project Overview
Real-time Pakistan Stock Exchange (PSX) trading dashboard with WebSocket-based live data.

## Tech Stack
- **Backend**: Node.js + Express + WebSocket (`ws` library)
- **Frontend**: Vanilla JavaScript (no framework), CSS custom properties
- **Data Flow**: WebSocket request/response pattern, server polls PSX API every 3 seconds

## File Structure
project/
├── server.js # Express + WebSocket server
├── services/ # Backend services (already modular)
│ ├── authService.js
│ ├── orderBookService.js
│ ├── tradingSignalService.js
│ ├── newsService.js
│ ├── announcementService.js
│ ├── institutionalTrackerService.js
│ ├── orderFlowTrackerService.js
│ ├── indexTrackerService.js
│ ├── globalIndicesService.js
│ ├── sectorAnalysisService.js
│ ├── fipiLipService.js
│ ├── sectorMappingService.js
│ └── tradeJournalService.js
└── public/
├── index.html # HTML structure with all tabs
├── css/
│ ├── main.css # CSS variables, core layout, login, header
│ ├── components.css # Navigation, tabs, stock cards, modal, filters
│ └── tabs.css # Tab-specific styles (order book, news, signals, etc.)
└── js/
├── config.js # Constants (intervals, limits)
├── utils.js # Helpers: formatVol(), getSignalBg(), stockCard(), etc.
├── state.js # Global state object (State.stocks, State.watchlist, etc.)
├── websocket.js # WS connection, send(), reconnect logic
├── messageHandler.js # Routes ALL incoming WS messages to UI modules
├── app.js # Main controller, tab switching, init
└── ui/
├── common.js # UI.showLogin(), UI.showMain(), UI.updateStatus(), UI.updateMarketBar()
├── market.js # UIMarket.render() - market tab with filters
├── watchlist.js # UIWatchlist.render() - watchlist tab
├── modal.js # UIModal.render() - stock detail modal
├── orderbook.js # UIOrderBook.render() - order book with trap detection
├── news.js # UINews.renderSignal(), renderTicker(), renderStockNews()
├── announcements.js # UIAnnouncements.render(), filter(), display()
├── signals.js # UISignals.render() - trading signals tab
├── premarket.js # UIPremarket.analyze(), render() - pre-market scanner
├── institutional.js # UIInstitutional.analyze(), render() - whale tracker
├── orderflow.js # UIOrderFlow.render(), updateSummary()
├── indexTracker.js # UIIndexTracker.render() - KSE-100 tracker
├── globalIndices.js # UIGlobalIndices.render() - world markets
├── sectors.js # UISectors.render(), showStocks(), renderSectorStocks()
├── fipilipi.js # UIFipiLipi.render() - foreign/local investor flows
├── tradeJournal.js # UITradeJournal.render(), takeTradeFromSignal(), closeTrade(), averageDown()
└── search.js # UISearch.render() - search results


## Key Patterns

### Adding a New Tab
1. Add nav button in `index.html`: `<button class="nav-btn" data-tab="newtab">...`
2. Add tab div in `index.html`: `<div id="newtabTab" class="tab">...</div>`
3. Create `public/js/ui/newtab.js` with `UINewtab` object
4. Add handler in `messageHandler.js` for the WebSocket response
5. Add tab case in `app.js` `switchTab()` method
6. Add `<script>` tag in `index.html`

### WebSocket Communication
```javascript
// Client sends request
WS.send({ type: 'GET_ORDERBOOK', symbol: 'HUBC' });

// Server responds, messageHandler routes it
case 'ORDERBOOK_UPDATE':
    if (msg.data) UIOrderBook.render(msg.data);
    break;

    State Management
All global state is in State object (state.js):

State.stocks[] - all stock data

State.stockMap - Map for O(1) lookup by symbol

State.watchlist[] - persisted in localStorage

State.currentFilter - market tab filter

State.currentModalSymbol - currently open stock detail

CSS Variables (in :root)

--bg: #0f172a;    /* Main background */
--bg2: #1e293b;   /* Card background */
--bg3: #334155;   /* Accent background */
--text: #f1f5f9;  /* Primary text */
--text2: #94a3b8; /* Secondary text */
--green: #22c55e; --red: #ef4444; --blue: #3b82f6;
--orange: #f59e0b; --purple: #a855f7;

Common Request Types
When asking AI to modify code, specify:

Which file(s) to modify

What the new feature/change should do

Any new WebSocket message types needed

Whether new CSS classes are needed

Example Prompt:

Modify public/js/ui/orderbook.js to add a "Depth Chart" visualization below the order book.
- Add a canvas element in index.html inside #orderBookContent
- Create a bar chart showing cumulative bid/ask volume at each price level
- Use existing CSS variables for colors
- No new WebSocket messages needed, use existing orderbook data

Current Features (14 Tabs)
Market - All stocks with gainers/losers/volume filters

Watchlist - User's saved stocks

Signals - AI trading signals with entry/target/stop

Journal - Trade tracking with P&L

PreMkt - Pre-market gap scanner

Inst - Institutional/smart money detection

Flow - Order flow buy/sell ratio analysis

News - AI news sentiment + 24h ticker

Announce - Corporate announcements (results, dividends, etc.)

Index - KSE-100 tracker with volume analysis

World - Global indices comparison

Sectors - Sector analysis with FIPI/LIPI data

FIPI/LIPI - Foreign vs local investor flows

Search - Symbol/name search


---

When you need AI help tomorrow, just paste this context along with your specific request. For example:

> *"Here's my project context [paste AI_CONTEXT.md]. I need to add a new feature to the orderbook.js that shows volume profile. Only modify public/js/ui/orderbook.js and add any needed CSS to tabs.css."*

This way the AI understands exactly what files exist, how they connect, and can give you targeted changes without needing the entire codebase.