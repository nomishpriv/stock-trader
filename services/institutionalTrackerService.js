'use strict';

const fs = require('fs');
const path = require('path');
const { api } = require('./authService');

const DATA_DIR = path.join(__dirname, '..', 'data', 'institutional');

class InstitutionalTrackerService {
    // ============ CONFIGURABLE INSTITUTIONAL WEIGHTS ============
    static INSTITUTIONAL_WEIGHTS = {
        orderBookDelta: 0.35,    // Bid vol change, ratio change
        priceVolume: 0.30,       // Price move confirmed by volume
        largeOrders: 0.20,       // Whale detection
        marketStructure: 0.15    // Spread, trap confidence, support/resistance
    };

    constructor() {
        this.todayFile = this.getTodayFile();
        this.data = this.loadData();
        this.snapshots = new Map(); // Store previous order book snapshots
        this.alerts = [];
    }

    getTodayFile() {
        const today = new Date().toISOString().split('T')[0];
        return path.join(DATA_DIR, `institutional-${today}.json`);
    }

    loadData() {
        try {
            if (fs.existsSync(this.todayFile)) {
                return JSON.parse(fs.readFileSync(this.todayFile, 'utf8'));
            }
        } catch (e) {}
        
        return {
            date: new Date().toISOString().split('T')[0],
            stocks: {},
            signals: [],
            summary: {
                activeStocks: 0,
                strongBuySignals: 0,
                buySignals: 0,
                sellSignals: 0,
                lastUpdated: null
            }
        };
    }

    saveData() {
        try {
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(this.todayFile, JSON.stringify(this.data, null, 2));
        } catch (e) {}
    }

    /**
     * Analyze a single stock for institutional activity
     * Compares current order book with previous snapshot
     * and checks actual trade executions
     */
    async analyzeStock(stockData, orderBookData) {
        const symbol = stockData.symbol;
        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);

        // Initialize stock tracking
        if (!this.data.stocks[symbol]) {
            this.data.stocks[symbol] = {
                symbol,
                name: stockData.name || symbol,
                price: stockData.price,
                entries: [],
                currentSignal: 'NEUTRAL',
                signalStrength: 0,
                lastAlert: null
            };
        }

        const stock = this.data.stocks[symbol];
        const prevSnapshot = this.snapshots.get(symbol);
        const avgDailyVol = stockData.volAvg10d || stockData.volume || 1;

        // Current metrics
        const currentMetrics = {
            time: timeStr,
            price: stockData.price,
            volume: stockData.volume,
            changePercent: stockData.changePercent,
            bidVol: orderBookData?.totalBidVolume || 0,
            askVol: orderBookData?.totalAskVolume || 0,
            bidAskRatio: orderBookData?.bidAskRatio || 1,
            imbalance: orderBookData?.imbalance || 0,
            spreadPercent: orderBookData?.spreadPercent || 0,
            top3BidVol: orderBookData?.top3BidVol || 0,
            top3AskVol: orderBookData?.top3AskVol || 0,
            largeBids: (orderBookData?.largeOrders || []).filter(o => o.type === 'BID').length,
            largeAsks: (orderBookData?.largeOrders || []).filter(o => o.type === 'ASK').length,
            bestBid: orderBookData?.bestBid || 0,
            bestAsk: orderBookData?.bestAsk || 0,
            trapConfidence: orderBookData?.trapDetection?.confidence || 50
        };

        // ─── COMPONENT SCORING (each 0-100) ───
        const components = {
            orderBookDelta: 50,
            priceVolume: 50,
            largeOrders: 50,
            marketStructure: 50
        };
        const reasons = [];

        if (prevSnapshot) {
            // 1. ORDER BOOK DELTA (0-100, 50=neutral)
            let obScore = 50;
            const bidChange = currentMetrics.bidVol - prevSnapshot.bidVol;
            const askChange = currentMetrics.askVol - prevSnapshot.askVol;
            const bidChangePct = prevSnapshot.bidVol > 0 ? (bidChange / prevSnapshot.bidVol) * 100 : 0;
            const askChangePct = prevSnapshot.askVol > 0 ? (askChange / prevSnapshot.askVol) * 100 : 0;

            // Normalize bid volume changes relative to avg daily volume
            const bidChangeRel = bidChange / avgDailyVol;
            if (bidChangeRel > 0.05) { obScore += 20; reasons.push(`Bid volume surged (+${(bidChangePct).toFixed(0)}%)`); }
            else if (bidChangeRel > 0.02) { obScore += 12; reasons.push(`Bid volume rising (+${(bidChangePct).toFixed(0)}%)`); }
            else if (bidChangeRel > 0.005) { obScore += 5; reasons.push(`Bid volume increasing`); }
            else if (bidChangeRel < -0.03) { obScore -= 15; reasons.push(`Bid volume dropping`); }

            const ratioChange = currentMetrics.bidAskRatio - prevSnapshot.bidAskRatio;
            if (ratioChange > 1.5 && currentMetrics.bidAskRatio > 2.5) { obScore += 15; reasons.push('Buy pressure intensifying'); }
            else if (ratioChange > 0.5 && currentMetrics.bidAskRatio > 1.5) { obScore += 8; reasons.push('Buy pressure building'); }
            else if (ratioChange < -1) { obScore -= 10; reasons.push('Buy pressure fading'); }

            components.orderBookDelta = Math.max(0, Math.min(100, obScore));

            // 2. PRICE-VOLUME CONFIRMATION
            let pvScore = 50;
            const priceChange = currentMetrics.price - prevSnapshot.price;
            const priceChangePct = prevSnapshot.price > 0 ? (priceChange / prevSnapshot.price) * 100 : 0;
            const volChangePct = prevSnapshot.volume > 0 ? ((currentMetrics.volume - prevSnapshot.volume) / prevSnapshot.volume) * 100 : 0;

            if (priceChangePct > 0.5 && volChangePct > 20) { pvScore += 22; reasons.push('Price rising with volume — real buying'); }
            else if (priceChangePct > 0.3 && volChangePct > 10) { pvScore += 14; reasons.push('Price up with volume'); }
            else if (priceChangePct > 0.5 && volChangePct < -30) { pvScore -= 12; reasons.push('Price up on fading volume — weak'); }
            else if (priceChangePct < -0.5 && volChangePct > 20) { pvScore -= 22; reasons.push('Price falling with volume — real selling'); }
            else if (priceChangePct < -0.3 && volChangePct > 10) { pvScore -= 14; reasons.push('Price down with volume'); }

            components.priceVolume = Math.max(0, Math.min(100, pvScore));

            // 3. LARGE ORDERS
            let loScore = 50;
            const largeBidDelta = currentMetrics.largeBids - prevSnapshot.largeBids;
            const largeAskDelta = currentMetrics.largeAsks - prevSnapshot.largeAsks;

            if (largeBidDelta > 2 && volChangePct > 15) { loScore += 25; reasons.push('Large bids appearing + execution'); }
            else if (largeBidDelta > 0) { loScore += 10; reasons.push('New large bids'); }
            if (largeAskDelta > 2 && volChangePct > 15) { loScore -= 25; reasons.push('Large asks appearing + execution'); }
            else if (largeAskDelta > 0) { loScore -= 10; reasons.push('New large asks'); }

            components.largeOrders = Math.max(0, Math.min(100, loScore));

            // 4. MARKET STRUCTURE
            let msScore = 50;
            if (currentMetrics.spreadPercent < prevSnapshot.spreadPercent * 0.5 && currentMetrics.spreadPercent < 0.3) {
                msScore += 10; reasons.push('Spread tightening — accumulation');
            }
            if (currentMetrics.top3BidVol > prevSnapshot.top3BidVol * 1.5) {
                msScore += 8; reasons.push('Near-bid support strengthening');
            }
            if (currentMetrics.trapConfidence > 70 && prevSnapshot.trapConfidence < 50) {
                msScore += 12; reasons.push('Order book now validated');
            } else if (currentMetrics.trapConfidence < 40) {
                msScore -= 15; reasons.push('Order book suspicious');
            }

            components.marketStructure = Math.max(0, Math.min(100, msScore));
        }

        // 5. CURRENT STATE (independent of delta, blended into components)
        if (currentMetrics.bidAskRatio > 3 && currentMetrics.trapConfidence > 60) {
            components.orderBookDelta = Math.min(100, components.orderBookDelta + 8);
            if (!reasons.some(r => r.includes('Strong buy pressure'))) reasons.push('Strong buy pressure with confidence');
        }
        if (currentMetrics.imbalance > 40 && stockData.volume > avgDailyVol * 0.5) {
            components.priceVolume = Math.min(100, components.priceVolume + 8);
            if (!reasons.some(r => r.includes('Imbalance'))) reasons.push(`Heavy imbalance ${currentMetrics.imbalance}%`);
        }
        if (stockData.r1 && currentMetrics.price >= stockData.r1 && stockData.volume > avgDailyVol * 1.2) {
            components.priceVolume = Math.min(100, components.priceVolume + 12);
            if (!reasons.some(r => r.includes('resistance'))) reasons.push('Breaking resistance with volume');
        }

        // ─── FINAL WEIGHTED SCORE ───
        let finalScore = 0;
        for (const [key, weight] of Object.entries(InstitutionalTrackerService.INSTITUTIONAL_WEIGHTS)) {
            finalScore += (components[key] || 50) * weight;
        }
        finalScore = Math.max(0, Math.min(100, finalScore));

        // ─── SIGNAL MAPPING (0-100 → signal) ───
        let signal, emoji, color;
        if (finalScore >= 82) {
            signal = 'STRONG_INSTITUTIONAL_BUY';
            emoji = '🐋🐋';
            color = '#a855f7';
        } else if (finalScore >= 68) {
            signal = 'INSTITUTIONAL_BUY';
            emoji = '🐋';
            color = '#22c55e';
        } else if (finalScore >= 58) {
            signal = 'BUILDING';
            emoji = '📈';
            color = '#4ade80';
        } else if (finalScore >= 48) {
            signal = 'WATCH';
            emoji = '👀';
            color = '#f59e0b';
        } else if (finalScore <= 22) {
            signal = 'DISTRIBUTION';
            emoji = '🔴';
            color = '#ef4444';
        } else if (finalScore <= 35) {
            signal = 'WEAKENING';
            emoji = '📉';
            color = '#f87171';
        } else {
            signal = 'NEUTRAL';
            emoji = '➖';
            color = '#94a3b8';
        }

        // ─── STORE ENTRY ───
        const entry = {
            ...currentMetrics,
            score: Math.round(finalScore),
            components,
            signal,
            emoji,
            reasons: reasons.slice(0, 5),
            previousSignal: stock.currentSignal
        };

        stock.entries.push(entry);
        if (stock.entries.length > 30) stock.entries = stock.entries.slice(-30);

        // ─── ALERT ON SIGNAL UPGRADE ───
        if (signal !== stock.currentSignal && (signal.includes('BUY') || signal === 'BUILDING')) {
            const alert = {
                symbol,
                time: timeStr,
                signal,
                emoji,
                score: Math.round(finalScore),
                reasons: reasons.slice(0, 3),
                price: stockData.price,
                changePercent: stockData.changePercent
            };
            this.alerts.push(alert);
            if (this.alerts.length > 50) this.alerts = this.alerts.slice(-50);
            stock.lastAlert = alert;
        }

        stock.currentSignal = signal;
        stock.signalStrength = Math.round(finalScore);
        stock.price = stockData.price;

        // Update snapshot
        this.snapshots.set(symbol, currentMetrics);

        return entry;
    }

    /**
     * Get active institutional signals for display
     */
    getActiveSignals(minScore = 6) {
        const signals = [];
        
        for (const [symbol, stock] of Object.entries(this.data.stocks)) {
            if (stock.signalStrength >= minScore && stock.entries.length > 0) {
                const lastEntry = stock.entries[stock.entries.length - 1];
                signals.push({
                    symbol,
                    name: stock.name,
                    price: stock.price,
                    signal: stock.currentSignal,
                    emoji: lastEntry.emoji,
                    score: stock.signalStrength,
                    reasons: lastEntry.reasons,
                    changePercent: lastEntry.changePercent,
                    bidAskRatio: lastEntry.bidAskRatio,
                    volume: lastEntry.volume,
                    time: lastEntry.time,
                    lastAlert: stock.lastAlert
                });
            }
        }

        // Sort by score (strongest first)
        signals.sort((a, b) => b.score - a.score);
        
        // Update summary
        this.data.summary.activeStocks = signals.length;
        this.data.summary.strongBuySignals = signals.filter(s => s.signal === 'STRONG_INSTITUTIONAL_BUY').length;
        this.data.summary.buySignals = signals.filter(s => s.signal === 'INSTITUTIONAL_BUY').length;
        this.data.summary.lastUpdated = new Date().toISOString();
        
        this.saveData();
        
        return signals.slice(0, 20);
    }

    /**
     * Get recent alerts
     */
    getAlerts(limit = 15) {
        return this.alerts.slice(-limit).reverse();
    }

    /**
     * Get stock-specific history
     */
    getStockHistory(symbol) {
        const stock = this.data.stocks[symbol.toUpperCase()];
        if (!stock) return null;
        return {
            symbol,
            name: stock.name,
            price: stock.price,
            currentSignal: stock.currentSignal,
            signalStrength: stock.signalStrength,
            entries: stock.entries.slice(-20),
            lastAlert: stock.lastAlert
        };
    }

    formatVol(v) {
        if (!v) return '0';
        if (v >= 1000000) return (v/1000000).toFixed(1) + 'M';
        if (v >= 1000) return (v/1000).toFixed(0) + 'K';
        return v.toString();
    }
}

module.exports = new InstitutionalTrackerService();