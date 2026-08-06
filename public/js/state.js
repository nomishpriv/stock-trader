// Global state management
const State = {
    ws: null,
    connected: false,
    loggedIn: false,
    stocks: [],
    kse100: null,
    watchlist: JSON.parse(localStorage.getItem('watchlist') || '[]'),
    currentFilter: 'all',
    currentSignalFilter: 'all',
    currentSectorFilter: 'all',
    currentModalSymbol: null,
    reconnectTimer: null,
    stockMap: new Map(),
    currentOrderBook: null,
    orderBookTimer: null,
    newsSignal: null,
    preMarketTimerInterval: null,
    allAnnouncements: [],
    announcementTabs: [],
    currentAnnFilter: 'all',
    announcementsByType: {},
    sectorFilterSymbols: null,
    currentSectorName: null,

    buildStockMap() {
        this.stockMap.clear();
        this.stocks.forEach(s => this.stockMap.set(s.symbol, s));
    },

    updateStocksData(newStocks) {
        newStocks.forEach(s => {
            const existing = this.stockMap.get(s.symbol);
            if (existing) Object.assign(existing, s);
            else this.stockMap.set(s.symbol, s);
        });
        this.stocks = Array.from(this.stockMap.values());
    }
};