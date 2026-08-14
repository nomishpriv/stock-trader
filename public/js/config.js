// Configuration constants
const CONFIG = {
    UPDATE_INTERVAL: 2000,      // Update visible cards every 2s
    SIGNALS_INTERVAL: 60000,    // Refresh trading signals every 60s
    ORDERBOOK_INTERVAL: 5000,   // Refresh order book every 5s when modal open
    RECONNECT_DELAY: 3000,      // WebSocket reconnect delay
    MAX_MARKET_STOCKS: 50,      // Max stocks to show in market tab
    MAX_CLOSED_TRADES: 20,      // Max closed trades to show
    TRADE_CAPITAL: 100000,        // Reference capital for position sizing
    TRADE_RISK_PERCENT: 0.02,   // Risk 2% of capital per trade
    MIN_TRADE_QUANTITY: 10,
    MAX_TRADE_QUANTITY: 10000,
    MIN_SIGNAL_SCORE_TAKE: 9,   // Block WEAK_BUY — require BUY or STRONG_BUY
    DEFAULT_TRADE_QUANTITY: 500 // Fallback only; prefer calculateTradeQuantity()
};

/** Risk-based share count: same logic as server calculateQuantity */
function calculateTradeQuantity(entryPrice, stopLoss) {
    const stopDistance = Math.abs(entryPrice - stopLoss);
    if (stopDistance <= 0) return CONFIG.DEFAULT_TRADE_QUANTITY;
    const riskAmount = CONFIG.TRADE_CAPITAL * CONFIG.TRADE_RISK_PERCENT;
    const qty = Math.floor(riskAmount / stopDistance);
    return Math.max(CONFIG.MIN_TRADE_QUANTITY, Math.min(CONFIG.MAX_TRADE_QUANTITY, qty));
}