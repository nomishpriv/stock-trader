'use strict';

/**
 * ================================================================
 * IMPROVED TRADE JOURNAL SERVICE v2.0
 * Changes:
 *  1. Auto-trade support (source tracking, no averaging down for auto)
 *  2. Daily loss limit protection
 *  3. Exposure limit tracking
 *  4. Better P&L calculation with fees estimation
 *  5. Trade validation before opening
 * ================================================================
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'trades');
const OPEN_TRADES_FILE = path.join(DATA_DIR, 'open-trades.json');
const CLOSED_TRADES_FILE = path.join(DATA_DIR, 'closed-trades.json');
const TRADE_HISTORY_DIR = path.join(DATA_DIR, 'history');

// ✅ NEW: Risk management config
const RISK_CONFIG = {
    maxDailyLoss: -50000,      // Stop trading if daily loss exceeds Rs. 50K
    maxOpenExposure: 500000,   // Max Rs. 5L in open positions
    maxTradesPerDay: 20,       // Prevent over-trading
    maxRiskPerTrade: 2500,     // Max Rs. 2,500 risk per position (2.5% of 100K)
    maxOpenTrades: 5,          // Cap concurrent positions
    brokerageRate: 0.001,      // 0.1% per side (buy + sell)
    taxRate: 0.0002,           // 0.02% CVT
    trailingStopPercent: 0.5,  // Trail stop up when price rises 0.5% from entry
    dayTradeCloseHour: 15,     // Auto-close DAY trades at 3:00 PM PKT
    dayTradeCloseMinute: 0,
    maxHoldDaysSwing: 5        // Force review/exit swing trades after 5 days
};

class TradeJournalService {
    constructor() {
        this.openTrades = this.loadOpenTrades();
        this.closedTrades = this.loadClosedTrades();
    }

    loadOpenTrades() {
        try { if (fs.existsSync(OPEN_TRADES_FILE)) return JSON.parse(fs.readFileSync(OPEN_TRADES_FILE, 'utf8')); } catch (e) {}
        return [];
    }

    loadClosedTrades() {
        try { if (fs.existsSync(CLOSED_TRADES_FILE)) return JSON.parse(fs.readFileSync(CLOSED_TRADES_FILE, 'utf8')); } catch (e) {}
        return [];
    }

    saveOpenTrades() {
        try {
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(OPEN_TRADES_FILE, JSON.stringify(this.openTrades, null, 2));
        } catch (e) { console.error('Save open trades failed:', e.message); }
    }

    saveClosedTrades() {
        try {
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(CLOSED_TRADES_FILE, JSON.stringify(this.closedTrades, null, 2));
        } catch (e) { console.error('Save closed trades failed:', e.message); }
    }

    saveTradeHistory(trade) {
        try {
            const month = new Date().toISOString().substring(0, 7);
            const historyDir = path.join(TRADE_HISTORY_DIR, month);
            if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
            const file = path.join(historyDir, `${trade.id}.json`);
            fs.writeFileSync(file, JSON.stringify(trade, null, 2));
        } catch (e) {}
    }

    // ✅ NEW: Risk check before opening trade
    canOpenTrade(symbol, quantity, entryPrice, source = 'MANUAL', stopLoss = null) {
        const today = new Date().toISOString().split('T')[0];
        const todayTrades = this.closedTrades.filter(t => 
            t.exitDate && t.exitDate.startsWith(today)
        );
        const todayPnl = todayTrades.reduce((s, t) => s + (t.finalPnl || 0), 0);
        const todayCount = todayTrades.length + this.openTrades.filter(t => 
            t.entryDate.startsWith(today)
        ).length;
        const openExposure = this.openTrades.reduce((s, t) => s + t.totalCost, 0);
        const tradeValue = quantity * entryPrice;

        if (todayPnl <= RISK_CONFIG.maxDailyLoss) {
            return { allowed: false, reason: `Daily loss limit reached: Rs.${todayPnl}` };
        }
        if (todayCount >= RISK_CONFIG.maxTradesPerDay) {
            return { allowed: false, reason: `Max ${RISK_CONFIG.maxTradesPerDay} trades/day reached` };
        }
        if (openExposure + tradeValue > RISK_CONFIG.maxOpenExposure) {
            return { allowed: false, reason: `Exposure limit Rs.${RISK_CONFIG.maxOpenExposure} would be exceeded` };
        }
        if (source === 'MANUAL' || source === 'SIGNAL_TAB') {
            const existing = this.openTrades.find(t => t.symbol === symbol);
            if (existing) {
                return { allowed: false, reason: `Already holding ${symbol}` };
            }
        }
        if (this.openTrades.length >= RISK_CONFIG.maxOpenTrades) {
            return { allowed: false, reason: `Max ${RISK_CONFIG.maxOpenTrades} open trades — close one first` };
        }
        if (stopLoss != null && stopLoss > 0) {
            const riskPerShare = Math.abs(entryPrice - stopLoss);
            const tradeRisk = riskPerShare * quantity;
            if (tradeRisk > RISK_CONFIG.maxRiskPerTrade) {
                const maxQty = Math.floor(RISK_CONFIG.maxRiskPerTrade / riskPerShare);
                return {
                    allowed: false,
                    reason: `Risk Rs.${tradeRisk.toFixed(0)} > max Rs.${RISK_CONFIG.maxRiskPerTrade}. Use ≤${maxQty} shares`
                };
            }
        }

        return { allowed: true, reason: 'OK' };
    }

    /**
     * Open a new trade from signal
     */
    openTrade(params) {
        const { symbol, name, signal, tradeType, entryPrice, targetPrice, stopLoss, quantity, riskReward, riskLevel, source } = params;

        // ✅ Risk check
        const riskCheck = this.canOpenTrade(symbol, quantity || 100, entryPrice, source, stopLoss);
        if (!riskCheck.allowed) {
            console.warn(`[TRADE BLOCKED] ${symbol}: ${riskCheck.reason}`);
            return { blocked: true, reason: riskCheck.reason };
        }

        const trade = {
            id: 'TRD' + Date.now(),
            symbol: symbol.toUpperCase(),
            name: name || symbol,
            signal,
            tradeType: tradeType || 'DAY',
            source: source || 'SIGNAL',
            status: 'OPEN',

            entryPrice: +entryPrice,
            entryDate: new Date().toISOString(),
            entryTime: new Date().toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' }),

            targetPrice: +targetPrice,
            stopLoss: +stopLoss,
            riskReward: +riskReward || 0,
            riskLevel: riskLevel || 'MEDIUM',

            quantity: +quantity || 100,
            totalCost: (+entryPrice * (+quantity || 100)),

            currentPrice: +entryPrice,
            currentPnl: 0,
            currentPnlPercent: 0,
            highestPrice: +entryPrice,
            lowestPrice: +entryPrice,

            exitPrice: null,
            exitDate: null,
            exitReason: null,

            averagedDown: false,
            averageCount: 0,
            averagePrices: [],

            notes: [],
            updates: [],
            initialStopLoss: +stopLoss,

            // ✅ NEW: Fee tracking
            entryFees: this.calculateFees(+entryPrice * (+quantity || 100))
        };

        this.openTrades.unshift(trade);
        this.saveOpenTrades();
        return trade;
    }

    // ✅ NEW: Fee calculator
    calculateFees(tradeValue) {
        const brokerage = tradeValue * RISK_CONFIG.brokerageRate;
        const tax = tradeValue * RISK_CONFIG.taxRate;
        return +(brokerage + tax).toFixed(2);
    }

    /**
     * Update all open trades with current prices
     */
    updateTrades(stocks) {
        if (!stocks || !stocks.length) return;

        const now = new Date();
        const pkTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
        const timeStr = pkTime.toTimeString().split(' ')[0].substring(0, 5);

        const hour = pkTime.getHours();
        const minutes = pkTime.getMinutes();
        const day = pkTime.getDay();
        const timeInMinutes = hour * 60 + minutes;
        let marketOpen = false;
        if (day >= 1 && day <= 4) {
            marketOpen = timeInMinutes >= (9*60+32) && timeInMinutes <= (15*60+30);
        } else if (day === 5) {
            marketOpen = (timeInMinutes >= (9*60+32) && timeInMinutes <= 12*60) ||
                         (timeInMinutes >= (14*60+32) && timeInMinutes <= (16*60+30));
        }

        const toClose = [];

        for (const trade of this.openTrades) {
            const stock = stocks.find(s => s.symbol === trade.symbol);
            if (!stock) continue;

            const prevPrice = trade.currentPrice;
            trade.currentPrice = stock.price;
            trade.highestPrice = Math.max(trade.highestPrice, stock.price);
            trade.lowestPrice = Math.min(trade.lowestPrice, stock.price);

            // ✅ Trailing stop: once up 0.5%+, move stop to breakeven; trail at 50% of gain
            const gainFromEntry = (trade.highestPrice - trade.entryPrice) / trade.entryPrice * 100;
            if (gainFromEntry >= RISK_CONFIG.trailingStopPercent) {
                const trailStop = trade.entryPrice + (trade.highestPrice - trade.entryPrice) * 0.5;
                if (trailStop > trade.stopLoss) {
                    trade.stopLoss = +trailStop.toFixed(2);
                }
            }

            const avgPrice = trade.quantity > 0 ? trade.totalCost / trade.quantity : trade.entryPrice;

            trade.currentPnl = +((stock.price - avgPrice) * trade.quantity).toFixed(2);
            trade.currentPnlPercent = +(((stock.price - avgPrice) / avgPrice) * 100).toFixed(2);

            const isDayTrade = (trade.tradeType || '').includes('DAY');
            const holdDays = (Date.now() - new Date(trade.entryDate).getTime()) / 86400000;

            // ✅ Auto-close pure DAY trades before market close
            if (marketOpen && isDayTrade && !(trade.tradeType || '').includes('SWING')) {
                if (hour > RISK_CONFIG.dayTradeCloseHour ||
                    (hour === RISK_CONFIG.dayTradeCloseHour && minutes >= RISK_CONFIG.dayTradeCloseMinute)) {
                    toClose.push({
                        id: trade.id,
                        price: stock.price,
                        reason: 'EOD_EXIT',
                        note: `DAY trade closed at ${timeStr} before market close`
                    });
                    continue;
                }
            }

            // ✅ Swing trades held too long with loss — cut
            if (marketOpen && holdDays >= RISK_CONFIG.maxHoldDaysSwing && trade.currentPnl < 0) {
                toClose.push({
                    id: trade.id,
                    price: stock.price,
                    reason: 'TIME_EXIT',
                    note: `Swing held ${Math.floor(holdDays)} days with loss — auto exit`
                });
                continue;
            }

            if (marketOpen) {
                if (stock.price >= trade.targetPrice) {
                    toClose.push({ id: trade.id, price: stock.price, reason: 'TARGET_HIT', note: `Target ${trade.targetPrice.toFixed(2)} reached at ${timeStr}` });
                    continue;
                }
                else if (stock.price <= trade.stopLoss) {
                    toClose.push({ id: trade.id, price: stock.price, reason: 'STOP_LOSS', note: `Stop loss ${trade.stopLoss.toFixed(2)} hit at ${timeStr}` });
                    continue;
                }
            }

            if (prevPrice !== stock.price) {
                trade.updates.push({
                    time: timeStr,
                    price: stock.price,
                    pnl: trade.currentPnl,
                    pnlPercent: trade.currentPnlPercent
                });
                if (trade.updates.length > 50) trade.updates = trade.updates.slice(-50);
            }
        }

        for (const c of toClose) {
            this.closeTrade(c.id, c.price, c.reason, c.note);
        }

        this.saveOpenTrades();
    }

    /**
     * Close a trade
     */
    closeTrade(tradeId, exitPrice, reason, note) {
        const idx = this.openTrades.findIndex(t => t.id === tradeId);
        if (idx === -1) return null;

        const trade = this.openTrades[idx];
        trade.status = 'CLOSED';
        trade.exitPrice = +exitPrice;
        trade.exitDate = new Date().toISOString();
        trade.exitReason = reason;
        trade.currentPrice = +exitPrice;

        const avgPrice = trade.quantity > 0 ? trade.totalCost / trade.quantity : trade.entryPrice;

        const grossPnl = +((exitPrice - avgPrice) * trade.quantity).toFixed(2);
        const exitFees = this.calculateFees(exitPrice * trade.quantity);
        const totalFees = (trade.entryFees || 0) + exitFees;

        trade.finalPnl = +(grossPnl - totalFees).toFixed(2);
        trade.finalPnlPercent = +(((exitPrice - avgPrice) / avgPrice) * 100).toFixed(2);
        trade.profit = trade.finalPnl > 0;
        trade.exitFees = exitFees;
        trade.totalFees = totalFees;

        if (note) trade.notes.push({ time: new Date().toISOString(), note });

        this.openTrades.splice(idx, 1);
        this.closedTrades.unshift(trade);

        if (this.closedTrades.length > 500) this.closedTrades = this.closedTrades.slice(0, 500);

        this.saveOpenTrades();
        this.saveClosedTrades();
        this.saveTradeHistory(trade);

        return trade;
    }

    /**
     * Average down on a trade
     * ✅ BLOCKED for auto-trader positions
     */
    averageDown(tradeId, additionalQuantity, currentPrice) {
        const trade = this.openTrades.find(t => t.id === tradeId);
        if (!trade) return null;

        // ✅ Auto-trader positions cannot be averaged down
        if (trade.source === 'AUTO_TRADER') {
            return { blocked: true, reason: 'Auto-trader positions cannot be averaged down' };
        }

        const qty = +additionalQuantity || 0;
        const price = +currentPrice || 0;
        if (qty <= 0 || price <= 0) return null;

        trade.averagedDown = true;
        trade.averageCount++;

        if (!Array.isArray(trade.averagePrices)) trade.averagePrices = [];
        trade.averagePrices.push({
            price: price,
            quantity: qty,
            time: new Date().toISOString()
        });

        trade.quantity += qty;
        trade.totalCost += (price * qty);

        const avgPrice = trade.quantity > 0 ? trade.totalCost / trade.quantity : trade.entryPrice;

        trade.notes.push({
            time: new Date().toISOString(),
            note: `Averaged down: +${qty} sh @ ${price.toFixed(2)}. New avg: ${avgPrice.toFixed(2)} (Total: ${trade.quantity} sh, Cost: Rs.${trade.totalCost.toFixed(0)})`
        });

        this.saveOpenTrades();
        return trade;
    }

    /**
     * Get trade summary statistics
     */
    getSummary() {
        const allClosed = this.closedTrades;
        const winning = allClosed.filter(t => t.finalPnl > 0);
        const losing = allClosed.filter(t => t.finalPnl <= 0);

        const totalPnl = allClosed.reduce((s, t) => s + (t.finalPnl || 0), 0);
        const totalWins = winning.length;
        const totalLosses = losing.length;
        const winRate = allClosed.length > 0 ? ((totalWins / allClosed.length) * 100).toFixed(1) : 0;

        const avgWin = totalWins > 0 ? (winning.reduce((s, t) => s + t.finalPnl, 0) / totalWins).toFixed(2) : 0;
        const avgLoss = totalLosses > 0 ? (losing.reduce((s, t) => s + t.finalPnl, 0) / totalLosses).toFixed(2) : 0;

        const todayStart = new Date().toISOString().split('T')[0];
        const todayTrades = allClosed.filter(t => t.exitDate?.startsWith(todayStart));
        const todayPnl = todayTrades.reduce((s, t) => s + (t.finalPnl || 0), 0);

        // ✅ NEW: Source breakdown
        const autoTrades = allClosed.filter(t => t.source === 'AUTO_TRADER');
        const autoWinRate = autoTrades.length > 0 
            ? (autoTrades.filter(t => t.profit).length / autoTrades.length * 100).toFixed(1) 
            : 0;

        return {
            openTrades: this.openTrades.length,
            totalClosed: allClosed.length,
            totalWins,
            totalLosses,
            winRate: +winRate,
            totalPnl: +totalPnl.toFixed(2),
            avgWin: +avgWin,
            avgLoss: +avgLoss,
            todayTrades: todayTrades.length,
            todayPnl: +todayPnl.toFixed(2),
            openExposure: this.openTrades.reduce((s, t) => s + t.totalCost, 0),
            // Auto-trader stats
            autoTrader: {
                totalAutoTrades: autoTrades.length,
                autoWinRate: +autoWinRate,
                autoPnl: +autoTrades.reduce((s, t) => s + (t.finalPnl || 0), 0).toFixed(2),
                openAutoPositions: this.openTrades.filter(t => t.source === 'AUTO_TRADER').length
            }
        };
    }

    /**
     * Get all trades for display
     */
    getAllTrades() {
        return {
            open: this.openTrades,
            closed: this.closedTrades.slice(0, 50),
            summary: this.getSummary()
        };
    }

    /**
     * ✅ NEW: Get risk status for dashboard
     */
    getRiskStatus() {
        const today = new Date().toISOString().split('T')[0];
        const todayPnl = this.closedTrades
            .filter(t => t.exitDate?.startsWith(today))
            .reduce((s, t) => s + (t.finalPnl || 0), 0);

        const openExposure = this.openTrades.reduce((s, t) => s + t.totalCost, 0);

        return {
            dailyLossLimit: RISK_CONFIG.maxDailyLoss,
            dailyLossCurrent: +todayPnl.toFixed(2),
            dailyLossRemaining: +(RISK_CONFIG.maxDailyLoss - todayPnl).toFixed(2),
            maxExposure: RISK_CONFIG.maxOpenExposure,
            currentExposure: openExposure,
            exposureRemaining: RISK_CONFIG.maxOpenExposure - openExposure,
            dailyLossBreached: todayPnl <= RISK_CONFIG.maxDailyLoss,
            exposureBreached: openExposure >= RISK_CONFIG.maxOpenExposure
        };
    }
}

module.exports = new TradeJournalService();