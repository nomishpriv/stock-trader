// Configuration constants
const CONFIG = {
    UPDATE_INTERVAL: 2000,      // Update visible cards every 2s
    SIGNALS_INTERVAL: 60000,    // Refresh trading signals every 60s
    ORDERBOOK_INTERVAL: 5000,   // Refresh order book every 5s when modal open
    RECONNECT_DELAY: 3000,      // WebSocket reconnect delay
    MAX_MARKET_STOCKS: 50,      // Max stocks to show in market tab
    MAX_CLOSED_TRADES: 20,      // Max closed trades to show
    DEFAULT_TRADE_QUANTITY: 500 // Default shares when taking trade
};