// Centralized message handler
const MessageHandler = {
    handle(msg) {
        switch (msg.type) {
            case 'LOGIN_STATUS':
                State.loggedIn = msg.loggedIn;
                State.loggedIn ? UI.showMain() : UI.showLogin(false);
                UI.updateStatus();
                break;
                
            case 'LOGIN_SUCCESS':
                State.loggedIn = true;
                UI.showMain();
                UI.updateStatus();
                setTimeout(() => {
                    WS.send({ type: 'GET_NEWS_SIGNAL' });
                    WS.send({ type: 'GET_ANNOUNCEMENTS' });
                    WS.send({ type: 'GET_TRADING_SIGNALS' });
                    WS.send({ type: 'GET_NEWS_TICKER' });
                    WS.send({ type: 'GET_INDEX_TRACKER' });
                    WS.send({ type: 'GET_ORDERFLOW' });
                    WS.send({ type: 'GET_GLOBAL_INDICES' });
                    WS.send({ type: 'GET_INSTITUTIONAL_SIGNALS' });
                    WS.send({ type: 'GET_TRADES' });
                }, 2000);
                break;
                
            case 'LOGIN_ERROR':
                UI.showLogin(false, msg.message);
                break;
                
            case 'LOGIN_EXPIRED':
                State.loggedIn = false;
                UI.showLogin(false, 'Session expired');
                UI.updateStatus();
                break;
                
            case 'MARKET_DATA':
            case 'MARKET_UPDATE':
                if (msg.data?.stocks) {
                    State.updateStocksData(msg.data.stocks);
                    State.kse100 = msg.data.kse100;
                    UI.updateMarketBar();
                    
                    if (State.stocks.length === 0 || Math.abs(State.stocks.length - msg.data.stocks.length) > 5) {
                        State.stocks = msg.data.stocks;
                        State.buildStockMap();
                        App.renderAll();
                    } else {
                        const nm = new Map();
                        msg.data.stocks.forEach(s => {
                            const existing = State.stockMap.get(s.symbol);
                            if (existing && (existing.price !== s.price || existing.changePercent !== s.changePercent || existing.volume !== s.volume)) {
                                UI.flashPrice(s.symbol, existing.price, s.price);
                                Object.assign(existing, s);
                            }
                            nm.set(s.symbol, s);
                        });
                        State.stocks = Array.from(State.stockMap.values());
                        UI.updateVisibleCards(nm);
                    }
                    
                    if (State.currentModalSymbol && document.getElementById('stockModal').classList.contains('active')) {
                        UIModal.updateFromCache(State.currentModalSymbol);
                    }
                    showToast();
                }
                break;
                
            case 'STOCK_DETAIL':
                if (msg.data) UIModal.render(msg.data);
                break;
                
            case 'ORDERBOOK_UPDATE':
                if (msg.data) UIOrderBook.render(msg.data);
                break;
                
            case 'ORDERBOOK_ERROR':
                document.getElementById('orderBookContent').innerHTML = 
                    `<div class="ob-error">⚠️ ${msg.message || 'Failed'}</div>`;
                break;
                
            case 'NEWS_SIGNAL':
                if (msg.data) UINews.renderSignal(msg.data);
                break;
                
            case 'NEWS_IMPACT':
                if (msg.data) UINews.renderTicker(msg.data.headlines);
                break;
                
            case 'STOCK_NEWS':
                if (msg.symbol === State.currentModalSymbol) UINews.renderStockNews(msg.symbol, msg.data);
                break;
                
            case 'NEWS_TICKER':
                if (msg.data) UINews.renderTicker(msg.data);
                break;
                
            case 'ANNOUNCEMENTS':
                if (msg.data) UIAnnouncements.render(msg.data);
                break;
                
            case 'STOCK_ANNOUNCEMENT':
                if (msg.symbol === State.currentModalSymbol) UIAnnouncements.renderStockAnnouncement(msg.data);
                break;
                
            case 'TRADING_SIGNALS':
                if (msg.data) UISignals.render(msg.data);
                break;
                
            case 'PREMARKET_ANALYSIS':
                if (msg.data) UIPremarket.render(msg.data);
                break;
                
            case 'INDEX_TRACKER':
                if (msg.data) UIIndexTracker.render(msg.data);
                break;
                
            case 'ORDERFLOW':
                if (msg.data) UIOrderFlow.render(msg.data);
                break;
                
            case 'ORDERFLOW_SUMMARY':
                if (msg.data) UIOrderFlow.updateSummary(msg.data);
                break;
                
            case 'GLOBAL_INDICES':
                if (msg.data) UIGlobalIndices.render(msg.data);
                break;
                
            case 'INSTITUTIONAL_SIGNALS':
                if (msg.data) UIInstitutional.render(msg.data);
                break;
                
            case 'TRADES_DATA':
                if (msg.data) UITradeJournal.render(msg.data);
                break;
                
            case 'TRADE_OPENED':
                WS.send({ type: 'GET_TRADES' });
                showToast();
                break;
                
            case 'TRADE_CLOSED':
                WS.send({ type: 'GET_TRADES' });
                break;
                
            case 'TRADE_ERROR':
                console.error('Trade Error:', msg.message);
                break;
                
            case 'SEARCH_RESULTS':
                UISearch.render(msg.data || []);
                break;
                
            case 'TRADE_AVERAGED':
                WS.send({ type: 'GET_TRADES' });
                showToast();
                break;
                
            case 'SECTOR_STOCKS':
                if (msg.data) UISectors.renderSectorStocks(msg.sector, msg.data);
                break;
                
            case 'FIPILIPI_DATA':
                if (msg.data) UIFipiLipi.render(msg.data);
                break;
                
            case 'SECTORS_DATA':
                if (msg.data) UISectors.render(msg.data);
                break;
                
            case 'FIPILIPI_WEEKLY':
                // Handled by FIPI/LIPI tab if needed
                break;
        }
    }
};