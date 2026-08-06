// Main application controller
const App = {
    init() {
        WS.connect();
        UI.showLogin();
        UI.updateStatus();
        this.setupEventListeners();
        this.startIntervals();
    },

    setupEventListeners() {
        // Login button
        document.getElementById('loginBtn').addEventListener('click', () => {
            document.getElementById('loginStatus').innerHTML = '<div class="spinner"></div><span>Logging in...</span>';
            document.getElementById('loginBtn').style.display = 'none';
            document.getElementById('loginError').textContent = '';
            WS.send({ type: 'LOGIN' });
        });

        // Navigation buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // Market filters
        document.querySelectorAll('[data-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                State.currentFilter = btn.dataset.filter;
                if (State.currentFilter !== 'sector') {
                    State.sectorFilterSymbols = null;
                    State.currentSectorName = null;
                }
                UIMarket.render();
            });
        });

        // Signal filters
        document.querySelectorAll('[data-signal-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-signal-filter]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                State.currentSignalFilter = btn.dataset.signalFilter;
                WS.send({ type: 'GET_TRADING_SIGNALS' });
            });
        });

        // Sector filters
        document.querySelectorAll('[data-sector-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-sector-filter]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                State.currentSectorFilter = btn.dataset.sectorFilter;
                WS.send({ type: 'GET_SECTORS' });
            });
        });

        // Search input
        document.getElementById('searchInput').addEventListener('input', e => {
            const q = e.target.value.trim();
            if (q.length >= 1) WS.send({ type: 'SEARCH', query: q });
            else document.getElementById('searchResults').innerHTML = '';
        });
    },

    startIntervals() {
        // Update visible cards
        setInterval(() => {
            if (State.stocks.length > 0 && document.getElementById('mainScreen').classList.contains('active')) {
                const nm = new Map(State.stocks.map(s => [s.symbol, s]));
                UI.updateVisibleCards(nm);
                if (State.currentModalSymbol && document.getElementById('stockModal').classList.contains('active')) {
                    UIModal.updateFromCache(State.currentModalSymbol);
                }
            }
        }, CONFIG.UPDATE_INTERVAL);

        // Refresh trading signals
        setInterval(() => {
            if (State.loggedIn) WS.send({ type: 'GET_TRADING_SIGNALS' });
        }, CONFIG.SIGNALS_INTERVAL);
    },

    switchTab(tabName) {
        // Update nav buttons
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        // Update tabs
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        const tabEl = document.getElementById(tabName + 'Tab');
        if (tabEl) tabEl.classList.add('active');

        // Tab-specific actions
        switch (tabName) {
            case 'watchlist':
                UIWatchlist.render();
                break;
            case 'market':
                if (State.sectorFilterSymbols && State.currentFilter === 'sector') {
                    State.currentFilter = 'all';
                    State.sectorFilterSymbols = null;
                    State.currentSectorName = null;
                }
                UIMarket.render();
                break;
            case 'indextracker':
                WS.send({ type: 'GET_INDEX_TRACKER' });
                break;
            case 'orderflow':
                WS.send({ type: 'GET_ORDERFLOW' });
                break;
            case 'globalindices':
                WS.send({ type: 'GET_GLOBAL_INDICES' });
                break;
            case 'institutional':
                WS.send({ type: 'GET_INSTITUTIONAL_SIGNALS' });
                break;
            case 'tradejournal':
                WS.send({ type: 'GET_TRADES' });
                break;
            case 'sectors':
            case 'fipilipi':
                WS.send({ type: 'GET_FIPILIPI' });
                WS.send({ type: 'GET_SECTORS' });
                break;
        }
    },

    openStock(sym) {
        const s = State.stockMap.get(sym);
        if (s) UIModal.render(s);
        
        document.getElementById('stockModal').classList.add('active');
        WS.send({ type: 'GET_STOCK', symbol: sym });
        
        // Reset loading states
        document.getElementById('orderBookContent').innerHTML = '<div class="ob-loading"><div class="spinner"></div><p>Loading...</p></div>';
        document.getElementById('stockNewsContent').innerHTML = '<div class="ob-loading"><p>Loading...</p></div>';
        document.getElementById('stockAnnContent').innerHTML = '<div class="ob-loading"><p>Loading...</p></div>';
        
        UIOrderBook.request(sym);
        WS.send({ type: 'GET_STOCK_NEWS', symbol: sym });
        WS.send({ type: 'GET_STOCK_ANNOUNCEMENT', symbol: sym });
    },

    closeModal() {
        document.getElementById('stockModal').classList.remove('active');
        State.currentModalSymbol = null;
        if (State.orderBookTimer) {
            clearInterval(State.orderBookTimer);
            State.orderBookTimer = null;
        }
    },

    toggleWatchlist(sym) {
        if (!sym) return;
        const i = State.watchlist.indexOf(sym);
        if (i > -1) State.watchlist.splice(i, 1);
        else State.watchlist.push(sym);
        
        localStorage.setItem('watchlist', JSON.stringify(State.watchlist));
        UIWatchlist.render();
        
        const btn = document.getElementById('modalWatchlistBtn');
        if (btn) btn.textContent = State.watchlist.includes(sym) ? '⭐' : '☆';
    },

    renderAll() {
        UIMarket.render();
        UIWatchlist.render();
    }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => App.init());