// ============ APP STATE ============
let ws = null;
let connected = false;
let loggedIn = false;
let stocks = [];
let watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
let currentTab = 'market';
let currentFilter = 'all';
let currentModalSymbol = null;

// ============ DOM ELEMENTS ============
function getElement(id) {
    return document.getElementById(id);
}

const loginScreen = getElement('loginScreen');
const mainScreen = getElement('mainScreen');
const loginStatus = getElement('loginStatus');
const loginBtn = getElement('loginBtn');
const loginError = getElement('loginError');
const marketList = getElement('marketList');
const watchlistList = getElement('watchlistList');
const watchlistEmpty = getElement('watchlistEmpty');
const searchInput = getElement('searchInput');
const searchResults = getElement('searchResults');
const stockModal = getElement('stockModal');
const toast = getElement('toast');
const statusDot = getElement('statusDot');
const statusText = getElement('statusText');

// ============ WEBSOCKET ============
function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
        connected = true;
        updateStatus();
        console.log('✅ WebSocket connected');
    };

    ws.onclose = () => {
        connected = false;
        updateStatus();
        console.log('❌ WebSocket disconnected, reconnecting...');
        setTimeout(connect, 3000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        connected = false;
        updateStatus();
    };

    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            handleMessage(msg);
        } catch (error) {
            console.error('Message parse error:', error);
        }
    };
}

function handleMessage(msg) {
    switch(msg.type) {
        case 'LOGIN_STATUS':
            loggedIn = msg.loggedIn;
            if (loggedIn) {
                showMainScreen();
            } else {
                showLoginScreen(false);
            }
            break;

        case 'LOGIN_SUCCESS':
            loggedIn = true;
            showMainScreen();
            break;

        case 'LOGIN_ERROR':
            showLoginScreen(false, msg.message);
            break;

        case 'LOGIN_EXPIRED':
            loggedIn = false;
            showLoginScreen(false, 'Session expired. Please login again.');
            break;

        case 'MARKET_DATA':
        case 'MARKET_UPDATE':
            if (msg.data && Array.isArray(msg.data)) {
                stocks = msg.data;
                renderAll();
                showToast();
            }
            break;

        case 'STOCK_DETAIL':
            if (msg.data && currentModalSymbol === msg.data.symbol) {
                renderModal(msg.data);
            }
            break;

        case 'SEARCH_RESULTS':
            if (msg.data) {
                renderSearchResults(msg.data);
            }
            break;
    }
}

function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

// ============ LOGIN ============
function doLogin() {
    if (!loginStatus) return;
    
    loginStatus.innerHTML = '<div class="spinner"></div><span>Logging in...</span>';
    if (loginBtn) loginBtn.style.display = 'none';
    if (loginError) loginError.textContent = '';
    send({ type: 'LOGIN' });
}

function showLoginScreen(autoLogin = true, error = '') {
    if (!loginScreen || !mainScreen) return;
    
    loginScreen.classList.add('active');
    mainScreen.classList.remove('active');
    
    if (!loginStatus) return;
    
    if (error) {
        loginStatus.innerHTML = '<span>❌ Connection failed</span>';
        if (loginError) loginError.textContent = error;
        if (loginBtn) loginBtn.style.display = 'block';
    } else if (autoLogin) {
        loginStatus.innerHTML = '<div class="spinner"></div><span>Connecting to market...</span>';
        if (loginBtn) loginBtn.style.display = 'none';
        // Try auto login after short delay
        setTimeout(() => {
            if (!loggedIn) {
                send({ type: 'LOGIN' });
            }
        }, 1000);
    } else {
        loginStatus.innerHTML = '<span>🔐 Login required</span>';
        if (loginBtn) loginBtn.style.display = 'block';
    }
}

function showMainScreen() {
    if (!loginScreen || !mainScreen) return;
    
    loginScreen.classList.remove('active');
    mainScreen.classList.add('active');
    renderAll();
}

// Add login button event listener safely
if (loginBtn) {
    loginBtn.addEventListener('click', doLogin);
}

// ============ RENDER ============
function renderAll() {
    renderMarket();
    renderWatchlist();
}

function renderMarket() {
    if (!marketList) return;
    
    let filtered = [...stocks];
    
    if (currentFilter === 'gainers') {
        filtered = filtered.filter(s => s.changePercent > 0);
    } else if (currentFilter === 'losers') {
        filtered = filtered.filter(s => s.changePercent < 0);
    } else if (currentFilter === 'volume') {
        filtered = filtered.filter(s => s.volume > 100000);
    }

    filtered.sort((a, b) => b.volume - a.volume);
    filtered = filtered.slice(0, 50);

    marketList.innerHTML = filtered.length > 0 
        ? filtered.map(s => stockCard(s)).join('')
        : '<div class="empty-state">No stocks found</div>';
}

function renderWatchlist() {
    if (!watchlistList || !watchlistEmpty) return;
    
    const watched = stocks.filter(s => watchlist.includes(s.symbol));
    
    if (watched.length === 0) {
        watchlistEmpty.style.display = 'block';
        watchlistList.style.display = 'none';
    } else {
        watchlistEmpty.style.display = 'none';
        watchlistList.style.display = 'flex';
        watchlistList.innerHTML = watched.map(s => stockCard(s)).join('');
    }
}

function renderSearchResults(results) {
    if (!searchResults) return;
    
    searchResults.innerHTML = results.length > 0
        ? results.map(s => stockCard(s)).join('')
        : '<div class="empty-state">No results found</div>';
}

function renderModal(stock) {
    const modalSymbol = getElement('modalSymbol');
    const modalName = getElement('modalName');
    const modalPrice = getElement('modalPrice');
    const modalChange = getElement('modalChange');
    const modalOpen = getElement('modalOpen');
    const modalHigh = getElement('modalHigh');
    const modalLow = getElement('modalLow');
    const modalVolume = getElement('modalVolume');
    const modalRSI = getElement('modalRSI');
    const modalPE = getElement('modalPE');
    const modalR2 = getElement('modalR2');
    const modalR1 = getElement('modalR1');
    const modalPivot = getElement('modalPivot');
    const modalS1 = getElement('modalS1');
    const modalS2 = getElement('modalS2');
    const modalWatchlistBtn = getElement('modalWatchlistBtn');
    
    if (modalSymbol) modalSymbol.textContent = stock.symbol;
    if (modalName) modalName.textContent = stock.name || '';
    if (modalPrice) modalPrice.textContent = stock.price?.toFixed(2) || '0.00';
    
    if (modalChange) {
        const change = stock.changePercent || 0;
        modalChange.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
        modalChange.className = `change ${change >= 0 ? 'up' : 'down'}`;
    }
    
    if (modalOpen) modalOpen.textContent = stock.open?.toFixed(2) || '-';
    if (modalHigh) modalHigh.textContent = stock.high?.toFixed(2) || '-';
    if (modalLow) modalLow.textContent = stock.low?.toFixed(2) || '-';
    if (modalVolume) modalVolume.textContent = formatVol(stock.volume);
    if (modalRSI) modalRSI.textContent = stock.rsi?.toFixed(1) || '-';
    if (modalPE) modalPE.textContent = stock.pe?.toFixed(2) || '-';
    
    if (modalR2) modalR2.textContent = stock.r2?.toFixed(2) || '-';
    if (modalR1) modalR1.textContent = stock.r1?.toFixed(2) || '-';
    if (modalPivot) modalPivot.textContent = stock.pivot?.toFixed(2) || '-';
    if (modalS1) modalS1.textContent = stock.s1?.toFixed(2) || '-';
    if (modalS2) modalS2.textContent = stock.s2?.toFixed(2) || '-';

    if (modalWatchlistBtn) {
        modalWatchlistBtn.textContent = watchlist.includes(stock.symbol) ? '⭐' : '☆';
        modalWatchlistBtn.onclick = () => toggleWatchlist(stock.symbol);
    }
}

function stockCard(stock) {
    const change = stock.changePercent || 0;
    const cls = change >= 0 ? 'up' : 'down';
    const sign = change >= 0 ? '+' : '';
    
    return `
        <div class="stock-card" onclick="openStock('${stock.symbol}')">
            <div class="stock-main">
                <div>
                    <div class="stock-symbol">${stock.symbol}</div>
                    <div class="stock-name">${(stock.name || '').substring(0, 20)}</div>
                </div>
                <div class="stock-price-info">
                    <div class="stock-price">${stock.price?.toFixed(2) || '0.00'}</div>
                    <div class="stock-change ${cls}">${sign}${change.toFixed(2)}%</div>
                </div>
            </div>
            <div class="stock-stats">
                <span>Vol: ${formatVol(stock.volume)}</span>
                <span>RSI: ${stock.rsi?.toFixed(1) || '-'}</span>
            </div>
        </div>
    `;
}

function formatVol(v) {
    if (!v) return '0';
    if (v >= 1000000) return (v/1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v/1000).toFixed(0) + 'K';
    return v.toString();
}

// ============ ACTIONS ============
function openStock(symbol) {
    currentModalSymbol = symbol;
    if (stockModal) stockModal.classList.add('active');
    send({ type: 'GET_STOCK', symbol });
}

function closeModal() {
    if (stockModal) stockModal.classList.remove('active');
    currentModalSymbol = null;
}

function toggleWatchlist(symbol) {
    const idx = watchlist.indexOf(symbol);
    if (idx > -1) {
        watchlist.splice(idx, 1);
    } else {
        watchlist.push(symbol);
    }
    localStorage.setItem('watchlist', JSON.stringify(watchlist));
    renderWatchlist();
    
    if (currentModalSymbol === symbol) {
        const modalWatchlistBtn = getElement('modalWatchlistBtn');
        if (modalWatchlistBtn) {
            modalWatchlistBtn.textContent = watchlist.includes(symbol) ? '⭐' : '☆';
        }
    }
}

function showToast() {
    if (!toast) return;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove('show'), 1500);
}

// ============ NAVIGATION ============
document.addEventListener('DOMContentLoaded', () => {
    // Navigation buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const tab = btn.dataset.tab;
            currentTab = tab;
            
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            const tabEl = document.getElementById(tab + 'Tab');
            if (tabEl) tabEl.classList.add('active');
            
            if (tab === 'watchlist') renderWatchlist();
            if (tab === 'market') renderMarket();
        });
    });

    // Filter buttons
    document.querySelectorAll('.filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderMarket();
        });
    });

    // Search input
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const q = e.target.value.trim();
            if (q.length >= 1) {
                send({ type: 'SEARCH', query: q });
            } else {
                if (searchResults) searchResults.innerHTML = '';
            }
        });
    }

    // Modal close on back button
    if (stockModal) {
        stockModal.addEventListener('click', (e) => {
            if (e.target === stockModal) {
                closeModal();
            }
        });
    }
});

// ============ STATUS ============
function updateStatus() {
    if (!statusDot || !statusText) return;
    
    if (connected && loggedIn) {
        statusDot.style.background = '#22c55e';
        statusText.textContent = 'Live';
    } else if (connected) {
        statusDot.style.background = '#f59e0b';
        statusText.textContent = 'Connecting...';
    } else {
        statusDot.style.background = '#ef4444';
        statusText.textContent = 'Offline';
    }
}

// ============ INIT ============
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.log('ServiceWorker registration failed:', err);
        });
    });
}

// Start the app
connect();
showLoginScreen();