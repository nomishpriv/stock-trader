'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { api } = require('./authService');

const DATA_DIR = path.join(__dirname, '..', 'data', 'orderflow');

class OrderFlowTrackerService {
    constructor() {
        this.todayFile = this.getTodayFile();
        this.data = this.loadData();
        this.trackedSymbols = new Set();
        this.lastFetchTime = {};
    }

    getTodayFile() {
        const today = new Date().toISOString().split('T')[0];
        return path.join(DATA_DIR, `orderflow-${today}.json`);
    }

    loadData() {
        try {
            if (fs.existsSync(this.todayFile)) {
                return JSON.parse(fs.readFileSync(this.todayFile, 'utf8'));
            }
        } catch (e) {}
        
        return {
            date: new Date().toISOString().split('T')[0],
            summary: {
                totalBuyVolume: 0,
                totalSellVolume: 0,
                totalTrades: 0,
                buyTrades: 0,
                sellTrades: 0,
                netFlow: 0,
                buyRatio: 0,
                pressure: 'NEUTRAL',
                lastUpdated: null
            },
            stocks: {},
            hourlyFlow: {},
            largeTrades: [],
            remarks: []
        };
    }

    saveData() {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            fs.writeFileSync(this.todayFile, JSON.stringify(this.data, null, 2));
        } catch (e) {
            console.error('Failed to save order flow data:', e.message);
        }
    }

    /**
     * Fetch executed trades for a symbol and classify as buy/sell
     */
    async fetchExecutedTrades(symbol) {
        try {
            const { data } = await api.get('/trading/trades', {
                params: { symbol: symbol.toUpperCase(), limit: 50 },
                timeout: 8000
            });

            const trades = Array.isArray(data) ? data : (data?.data || []);
            return trades;
        } catch (e) {
            return [];
        }
    }

    /**
     * Classify a trade as BUY or SELL based on price vs bid/ask
     * If trade price >= ask price → BUY (aggressive buyer)
     * If trade price <= bid price → SELL (aggressive seller)
     * Otherwise → check midpoint
     */
    classifyTrade(trade, bidPrice, askPrice, lastPrice, vwap) {
        const price = +trade.price || 0;
        const volume = +trade.volume || 0;
        
        if (!price || !volume) return null;

        let side = 'UNKNOWN';
        let confidence = 50;
        let method = 'UNKNOWN';
        const spread = (askPrice > bidPrice) ? (askPrice - bidPrice) : 0;
        const mid = spread > 0 ? (bidPrice + askPrice) / 2 : price;

        // ─── 1. AGGRESSIVE AT TOUCH ───
        if (askPrice > 0 && price >= askPrice - (spread * 0.05)) {
            // Within 5% of spread from ask = buyer lifting the offer
            side = 'BUY';
            confidence = 85;
            method = 'AT_ASK';
        } else if (bidPrice > 0 && price <= bidPrice + (spread * 0.05)) {
            // Within 5% of spread from bid = seller hitting the bid
            side = 'SELL';
            confidence = 85;
            method = 'AT_BID';
        } else if (bidPrice > 0 && askPrice > 0) {
            // ─── 2. INSIDE SPREAD ───
            side = price >= mid ? 'BUY' : 'SELL';
            confidence = 60;
            method = price >= mid ? 'ABOVE_MID' : 'BELOW_MID';

            // ─── 3. TICK TEST ───
            if (lastPrice > 0) {
                if (price > lastPrice) {
                    side = 'BUY';
                    confidence = Math.min(90, confidence + 20);
                    method += '+UPTICK';
                } else if (price < lastPrice) {
                    side = 'SELL';
                    confidence = Math.min(90, confidence + 20);
                    method += '+DOWNTICK';
                }
            }

            // ─── 4. VWAP TEST ───
            if (vwap > 0) {
                if (price > vwap && side === 'BUY') {
                    confidence = Math.min(95, confidence + 10);
                    method += '+ABOVE_VWAP';
                } else if (price < vwap && side === 'SELL') {
                    confidence = Math.min(95, confidence + 10);
                    method += '+BELOW_VWAP';
                } else if ((price > vwap && side === 'SELL') || (price < vwap && side === 'BUY')) {
                    confidence = Math.max(30, confidence - 15);
                    method += '+CONTRA_VWAP';
                }
            }
        } else {
            // ─── 5. NO BID/ASK DATA — TICK TEST ONLY ───
            if (lastPrice > 0) {
                if (price > lastPrice) { side = 'BUY'; confidence = 55; method = 'UPTICK_ONLY'; }
                else if (price < lastPrice) { side = 'SELL'; confidence = 55; method = 'DOWNTICK_ONLY'; }
                else { side = 'BUY'; confidence = 50; method = 'FLAT'; }
            } else {
                return null; // insufficient data — don't guess a direction
            }
        }

        return {
            time: trade.time || new Date().toISOString(),
            price,
            volume,
            side,
            confidence,
            method,
            value: price * volume
        };
    }

    /**
     * Track order flow for a list of symbols
     */
    async trackSymbols(symbols, stocksData) {
        const now = new Date();
        const hourKey = now.getHours().toString().padStart(2, '0') + ':00';
        
        // Initialize hourly bucket
        if (!this.data.hourlyFlow[hourKey]) {
            this.data.hourlyFlow[hourKey] = {
                buyVolume: 0,
                sellVolume: 0,
                buyTrades: 0,
                sellTrades: 0,
                netFlow: 0
            };
        }

        // Track top 30 stocks by volume (throttle to avoid rate limits)
        const topStocks = stocksData
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 30);

        for (const stock of topStocks) {
            const symbol = stock.symbol;
            
            // Throttle: don't fetch same symbol more than once per 30 seconds
            if (this.lastFetchTime[symbol] && (now - this.lastFetchTime[symbol]) < 30000) {
                continue;
            }
            
            this.lastFetchTime[symbol] = now;

            try {
                const trades = await this.fetchExecutedTrades(symbol);
                
                if (!trades.length) continue;

                // Initialize stock tracking
                if (!this.data.stocks[symbol]) {
                    this.data.stocks[symbol] = {
                        name: stock.name || symbol,
                        buyVolume: 0,
                        sellVolume: 0,
                        buyTrades: 0,
                        sellTrades: 0,
                        netFlow: 0,
                        totalTrades: 0,
                        lastPrice: stock.price,
                        vwap: 0,           // ✅ ADDED: running VWAP
                        vwapVolume: 0,     // ✅ ADDED: cumulative volume for VWAP

                        // ─── NEW: Price + Volume Confluence ───────────
                        priceChange: stock.changePercent || 0,
                        volumeRatio: stock.volAvg10d > 0
                            ? +(stock.volume / stock.volAvg10d).toFixed(2)
                            : 0,
                        buyValue: 0,
                        sellValue: 0,
                        vwapBuy: 0,
                        vwapSell: 0,
                        buyRatio: 50,
                        buyRatioValue: 50,
                        netFlowValue: 0,
                        priceVolumeSignal: 'NEUTRAL',
                        flowStrength: 0,
                        entries: []
                    };
                }

                                const stockData = this.data.stocks[symbol];
                // ✅ FIX: Use actual bid/ask from API; 0 is falsy so use explicit > 0 check
                const bidPrice = stock.bidPrice > 0 ? stock.bidPrice : 0;
                const askPrice = stock.askPrice > 0 ? stock.askPrice : 0;
                const lastPrice = stockData.lastPrice || stock.price || 0;
                const vwap = stockData.vwap || 0;
                const avgDailyVol = stock.volAvg10d || 0;

                for (const trade of trades) {
                    const classified = this.classifyTrade(trade, bidPrice, askPrice, lastPrice, vwap);
                    if (!classified) continue;

                    // Update stock data
                    if (classified.side === 'BUY') {
                        stockData.buyVolume += classified.volume;
                        stockData.buyTrades++;
                        stockData.buyValue += classified.value;
                        stockData.vwapBuy = stockData.buyVolume > 0
                            ? stockData.buyValue / stockData.buyVolume
                            : 0;

                        this.data.summary.totalBuyVolume += classified.volume;
                        this.data.summary.buyTrades++;
                        this.data.hourlyFlow[hourKey].buyVolume += classified.volume;
                        this.data.hourlyFlow[hourKey].buyTrades++;
                    } else if (classified.side === 'SELL') {
                        stockData.sellVolume += classified.volume;
                        stockData.sellTrades++;
                        stockData.sellValue += classified.value;
                        stockData.vwapSell = stockData.sellVolume > 0
                            ? stockData.sellValue / stockData.sellVolume
                            : 0;

                        this.data.summary.totalSellVolume += classified.volume;
                        this.data.summary.sellTrades++;
                        this.data.hourlyFlow[hourKey].sellVolume += classified.volume;
                        this.data.hourlyFlow[hourKey].sellTrades++;
                    }

                    stockData.totalTrades++;
                    this.data.summary.totalTrades++;
                    stockData.lastPrice = classified.price;

                    // ✅ ADDED: Update running VWAP
                    const prevVwapVol = stockData.vwapVolume;
                    stockData.vwapVolume += classified.volume;
                    stockData.vwap = prevVwapVol > 0
                        ? ((stockData.vwap * prevVwapVol) + (classified.price * classified.volume)) / stockData.vwapVolume
                        : classified.price;

                    // ✅ FIX: Relative large trade threshold (>0.5% of 10d avg OR >5M value)
                    const isLargeByVolume = avgDailyVol > 0 
                        ? classified.volume > avgDailyVol * 0.005 
                        : classified.volume > 100000;
                    const isLargeByValue = classified.value > 5000000;
                    if (isLargeByVolume || isLargeByValue) {
                        this.data.largeTrades.push({
                            symbol,
                            time: classified.time,
                            price: classified.price,
                            volume: classified.volume,
                            value: +classified.value.toFixed(0),
                            side: classified.side
                        });

                        // Keep only last 100 large trades
                        if (this.data.largeTrades.length > 100) {
                            this.data.largeTrades = this.data.largeTrades.slice(-100);
                        }
                    }

                    // Add to stock entries (keep last 20)
                    stockData.entries.push({
                        time: classified.time,
                        price: classified.price,
                        volume: classified.volume,
                        side: classified.side
                    });
                    if (stockData.entries.length > 20) {
                        stockData.entries = stockData.entries.slice(-20);
                    }
                }

                // Update stock net flow
                stockData.netFlow = stockData.buyVolume - stockData.sellVolume;
                stockData.netFlowValue = stockData.buyValue - stockData.sellValue;

                // Volume-based buy ratio
                const totalVol = stockData.buyVolume + stockData.sellVolume;
                stockData.buyRatio = totalVol > 0
                    ? +((stockData.buyVolume / totalVol) * 100).toFixed(1)
                    : 50;

                // Value-based buy ratio
                const totalValue = stockData.buyValue + stockData.sellValue;
                stockData.buyRatioValue = totalValue > 0
                    ? +((stockData.buyValue / totalValue) * 100).toFixed(1)
                    : 50;

                // ─── NEW: Price + Volume Confluence Signal ────────────
                const priceChg = stockData.priceChange || 0;
                const buyRatio = stockData.buyRatio;
                const volRatio = stockData.volumeRatio || 0;

                let signal = 'NEUTRAL';
                let strength = 0;

                if (priceChg > 0.5 && buyRatio >= 55) {
                    signal = 'ACCUMULATION';
                    strength = Math.min(100, (buyRatio - 50) * 2 + Math.min(Math.abs(priceChg) * 6, 30));
                    if (volRatio > 2) strength += 10;
                } else if (priceChg > 0.5 && buyRatio <= 45) {
                    signal = 'DISTRIBUTION';
                    strength = Math.min(100, (50 - buyRatio) * 2 + Math.min(Math.abs(priceChg) * 6, 30));
                    if (volRatio > 2) strength += 10;
                } else if (priceChg < -0.5 && buyRatio >= 55) {
                    signal = 'BUYING_DIP';
                    strength = Math.min(100, (buyRatio - 50) * 2 + Math.min(Math.abs(priceChg) * 4, 20));
                    if (volRatio > 2) strength += 10;
                } else if (priceChg < -0.5 && buyRatio <= 45) {
                    signal = 'DISTRIBUTION';
                    strength = Math.min(100, (50 - buyRatio) * 2 + Math.min(Math.abs(priceChg) * 6, 30));
                    if (volRatio > 2) strength += 10;
                } else if (buyRatio > 60 && volRatio > 1.5) {
                    signal = 'STRONG_BUY_FLOW';
                    strength = 60;
                } else if (buyRatio < 40 && volRatio > 1.5) {
                    signal = 'STRONG_SELL_FLOW';
                    strength = 60;
                }

                stockData.priceVolumeSignal = signal;
                stockData.flowStrength = Math.min(100, strength);

                this.trackedSymbols.add(symbol);

            } catch (e) {
                // Silent fail for individual stocks
            }
        }

        // Update summary calculations
        this.data.summary.netFlow = this.data.summary.totalBuyVolume - this.data.summary.totalSellVolume;
        const total = this.data.summary.totalBuyVolume + this.data.summary.totalSellVolume;
        this.data.summary.buyRatio = total > 0 ? +((this.data.summary.totalBuyVolume / total) * 100).toFixed(1) : 50;
        
        // Update hourly net flow
        this.data.hourlyFlow[hourKey].netFlow = 
            this.data.hourlyFlow[hourKey].buyVolume - this.data.hourlyFlow[hourKey].sellVolume;

        // Determine pressure
        const ratio = this.data.summary.buyRatio;
        if (ratio > 60) this.data.summary.pressure = 'STRONG_BUY';
        else if (ratio > 55) this.data.summary.pressure = 'BUY';
        else if (ratio > 45) this.data.summary.pressure = 'NEUTRAL';
        else if (ratio > 40) this.data.summary.pressure = 'SELL';
        else this.data.summary.pressure = 'STRONG_SELL';

        // Generate remarks
        this.generateRemarks();

        this.data.summary.lastUpdated = now.toISOString();
        this.saveData();

        return this.data;
    }

    generateRemarks() {
        const remarks = [];
        const ratio = this.data.summary.buyRatio;

        if (ratio > 60) {
            remarks.push('🔥 Heavy buying pressure — bulls in control');
        } else if (ratio > 55) {
            remarks.push('📈 Buyers dominating — positive sentiment');
        } else if (ratio > 45) {
            remarks.push('➖ Balanced market — buyers and sellers equal');
        } else if (ratio > 40) {
            remarks.push('📉 Sellers dominating — cautious sentiment');
        } else {
            remarks.push('🔴 Heavy selling pressure — bears in control');
        }

        // Volume analysis
        const totalVol = this.data.summary.totalBuyVolume + this.data.summary.totalSellVolume;
        if (totalVol > 50000000) {
            remarks.push('💪 Very high trading activity today');
        } else if (totalVol > 20000000) {
            remarks.push('📊 Moderate trading activity');
        } else if (totalVol > 0) {
            remarks.push('😴 Low trading activity');
        }

        // Large trades
        const recentLarge = this.data.largeTrades.slice(-10);
        const largeBuys = recentLarge.filter(t => t.side === 'BUY').length;
        const largeSells = recentLarge.filter(t => t.side === 'SELL').length;
        
        if (largeBuys > largeSells * 2) {
            remarks.push('🐋 Smart money buying — large orders on buy side');
        } else if (largeSells > largeBuys * 2) {
            remarks.push('🐋 Smart money selling — large orders on sell side');
        }

        // Top stock
        const topStocks = Object.entries(this.data.stocks)
            .sort((a, b) => Math.abs(b[1].netFlow) - Math.abs(a[1].netFlow))
            .slice(0, 3);
        
        if (topStocks.length > 0) {
            const topFlows = topStocks.map(([sym, data]) => 
                `${sym}(${data.netFlow > 0 ? '+' : ''}${this.formatVol(data.netFlow)})`
            ).join(', ');
            remarks.push(`📌 Most active: ${topFlows}`);
        }

        this.data.remarks = remarks;
    }

    formatVol(v) {
        if (!v) return '0';
        if (v >= 1000000) return (v/1000000).toFixed(1) + 'M';
        if (v >= 1000) return (v/1000).toFixed(0) + 'K';
        return v.toString();
    }

    getData() {
        return this.data;
    }

    getSummary() {
        return {
            buyVolume: this.data.summary.totalBuyVolume,
            sellVolume: this.data.summary.totalSellVolume,
            netFlow: this.data.summary.netFlow,
            buyRatio: this.data.summary.buyRatio,
            pressure: this.data.summary.pressure,
            totalTrades: this.data.summary.totalTrades,
            remarks: this.data.remarks || [],
            lastUpdated: this.data.summary.lastUpdated
        };
    }

    getTopStocks(limit = 10) {
        return Object.entries(this.data.stocks)
            .map(([symbol, data]) => {
                const totalVol = data.buyVolume + data.sellVolume;
                return {
                    symbol,
                    name: data.name,
                    buyVolume: data.buyVolume,
                    sellVolume: data.sellVolume,
                    netFlow: data.netFlow,
                    buyRatio: totalVol > 0 
                        ? +((data.buyVolume / totalVol) * 100).toFixed(1)
                        : 50,
                    totalTrades: data.totalTrades,
                    lastPrice: data.lastPrice,
                    vwap: data.vwap ? +data.vwap.toFixed(2) : 0,  // ✅ ADDED
                    avgPrice: totalVol > 0 
                        ? +(((data.buyVolume * (data.vwap || data.lastPrice)) + (data.sellVolume * (data.vwap || data.lastPrice))) / totalVol).toFixed(2) 
                        : 0
                };
            })
            .sort((a, b) => Math.abs(b.netFlow) - Math.abs(a.netFlow))
            .slice(0, limit);
    }

    getHourlyFlow() {
        return Object.entries(this.data.hourlyFlow)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([hour, data]) => ({
                hour,
                buyVolume: data.buyVolume,
                sellVolume: data.sellVolume,
                netFlow: data.netFlow,
                buyRatio: data.buyVolume + data.sellVolume > 0
                    ? +((data.buyVolume / (data.buyVolume + data.sellVolume)) * 100).toFixed(1)
                    : 50
            }));
    }

    getLargeTrades(limit = 20) {
        return this.data.largeTrades.slice(-limit).reverse();
    }

    /**
     * ✅ NEW: symbol → buyRatio lookup for confluence scoring
     */
    getAllBuyRatios() {
        const result = {};
        for (const [symbol, stock] of Object.entries(this.data.stocks)) {
            const total = stock.buyVolume + stock.sellVolume;
            result[symbol] = total > 0 ? +((stock.buyVolume / total) * 100).toFixed(1) : 50;
        }
        return result;
    }

    /**
     * 🔥 NEW: Full price + volume + flow confluence signals
     * Returns detailed per-symbol analysis for frontend / signal service
     */
    getAllFlowSignals(limit = 30) {
        return Object.entries(this.data.stocks)
            .map(([symbol, data]) => ({
                symbol,
                name: data.name,
                priceChange: data.priceChange || 0,
                volumeRatio: data.volumeRatio || 0,
                buyRatioVolume: data.buyRatio,
                buyRatioValue: data.buyRatioValue,
                netFlowVolume: data.netFlow,
                netFlowValue: +data.netFlowValue.toFixed(2),
                vwapBuy: data.vwapBuy ? +data.vwapBuy.toFixed(2) : 0,
                vwapSell: data.vwapSell ? +data.vwapSell.toFixed(2) : 0,
                signal: data.priceVolumeSignal,
                strength: data.flowStrength || 0
            }))
            .sort((a, b) => b.strength - a.strength)
            .slice(0, limit);
    }
}

module.exports = new OrderFlowTrackerService();