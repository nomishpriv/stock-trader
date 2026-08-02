'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'trades');
const OPEN_TRADES_FILE = path.join(DATA_DIR, 'open-trades.json');
const CLOSED_TRADES_FILE = path.join(DATA_DIR, 'closed-trades.json');
const TRADE_HISTORY_DIR = path.join(DATA_DIR, 'history');

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
            const month = new Date().toISOString().substring(0, 7); // YYYY-MM
            const historyDir = path.join(TRADE_HISTORY_DIR, month);
            if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
            const file = path.join(historyDir, `${trade.id}.json`);
            fs.writeFileSync(file, JSON.stringify(trade, null, 2));
        } catch (e) {}
    }

    /**
     * Open a new trade from signal
     */
    openTrade(params) {
        const { symbol, name, signal, tradeType, entryPrice, targetPrice, stopLoss, quantity, riskReward, riskLevel, source } = params;

        const trade = {
            id: 'TRD' + Date.now(),
            symbol: symbol.toUpperCase(),
            name: name || symbol,
            signal,
            tradeType: tradeType || 'DAY',
            source: source || 'SIGNAL',
            status: 'OPEN',
            
            // Entry
            entryPrice: +entryPrice,
            entryDate: new Date().toISOString(),
            entryTime: new Date().toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' }),
            
            // Exit targets
            targetPrice: +targetPrice,
            stopLoss: +stopLoss,
            riskReward: +riskReward || 0,
            riskLevel: riskLevel || 'MEDIUM',
            
            // Quantity & Cost
            quantity: +quantity || 100,
            totalCost: (+entryPrice * (+quantity || 100)),
            
            // Current state
            currentPrice: +entryPrice,
            currentPnl: 0,
            currentPnlPercent: 0,
            highestPrice: +entryPrice,
            lowestPrice: +entryPrice,
            
            // Exit info (filled when closed)
            exitPrice: null,
            exitDate: null,
            exitReason: null,
            
            // Accumulation
            averagedDown: false,
            averageCount: 0,
            averagePrices: [],
            
            // Notes
            notes: [],
            updates: []
        };

        this.openTrades.unshift(trade);
        this.saveOpenTrades();
        return trade;
    }

    /**
     * Update all open trades with current prices
     */
    updateTrades(stocks) {
        if (!stocks || !stocks.length) return;

        const now = new Date();
        const pkTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
        const timeStr = pkTime.toTimeString().split(' ')[0].substring(0, 5);
        
        // ✅ ADDED: Market-hours guard for auto-close
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

        const toClose = []; // ✅ FIX: Collect closures to avoid iterator invalidation

        for (const trade of this.openTrades) {
            const stock = stocks.find(s => s.symbol === trade.symbol);
            if (!stock) continue;

            const prevPrice = trade.currentPrice;
            trade.currentPrice = stock.price;
            trade.highestPrice = Math.max(trade.highestPrice, stock.price);
            trade.lowestPrice = Math.min(trade.lowestPrice, stock.price);

            // ✅ FIX: True weighted average = totalCost / totalQuantity
            const avgPrice = trade.quantity > 0 ? trade.totalCost / trade.quantity : trade.entryPrice;
            
            trade.currentPnl = +((stock.price - avgPrice) * trade.quantity).toFixed(2);
            trade.currentPnlPercent = +(((stock.price - avgPrice) / avgPrice) * 100).toFixed(2);

            // ✅ FIX: Only auto-close during market hours + collect for post-loop execution
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

            // Add price update
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

        // ✅ FIX: Close after loop to prevent skipped trades
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

        // ✅ FIX: True weighted average = totalCost / totalQuantity
        const avgPrice = trade.quantity > 0 ? trade.totalCost / trade.quantity : trade.entryPrice;
        
        trade.finalPnl = +((exitPrice - avgPrice) * trade.quantity).toFixed(2);
        trade.finalPnlPercent = +(((exitPrice - avgPrice) / avgPrice) * 100).toFixed(2);
        trade.profit = trade.finalPnl > 0;
        
        if (note) trade.notes.push({ time: new Date().toISOString(), note });

        // Move to closed
        this.openTrades.splice(idx, 1);
        this.closedTrades.unshift(trade);
        
        // Keep only last 500 closed trades
        if (this.closedTrades.length > 500) this.closedTrades = this.closedTrades.slice(0, 500);

        this.saveOpenTrades();
        this.saveClosedTrades();
        this.saveTradeHistory(trade);

        return trade;
    }

    /**
     * Average down on a trade
     */
    averageDown(tradeId, additionalQuantity, currentPrice) {
        const trade = this.openTrades.find(t => t.id === tradeId);
        if (!trade) return null;

        const qty = +additionalQuantity || 0;
        const price = +currentPrice || 0;
        if (qty <= 0 || price <= 0) return null;

        trade.averagedDown = true;
        trade.averageCount++;
        
        // ✅ FIX: Store price WITH quantity for true weighted average
        if (!Array.isArray(trade.averagePrices)) trade.averagePrices = [];
        trade.averagePrices.push({
            price: price,
            quantity: qty,
            time: new Date().toISOString()
        });
        
        trade.quantity += qty;
        trade.totalCost += (price * qty);
        
        // ✅ FIX: True weighted average = totalCost / totalQuantity
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
            openExposure: this.openTrades.reduce((s, t) => s + t.totalCost, 0)
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
}

module.exports = new TradeJournalService();