'use strict';

/**
 * ================================================================
 * IMPROVED TRADING SIGNAL SERVICE v2.0
 * Changes:
 *  1. Quality Gates — filters out penny/illiquid stocks before scoring
 *  2. Smart Stop-Loss — uses S1/S2 + minimum % buffer + ATR
 *  3. Market Regime Filter — no signals in strong downtrends
 *  4. Trend Filter — price must be above 20-day EMA
 *  5. Stricter R:R — minimum 1.5:1 for any signal to display
 *  6. Score Rebalancing — reduced RSI weight, added trend confluence
 * ================================================================
 */

class TradingSignalService {
    static SIGNAL_WEIGHTS = {
        technical: 0.30,
        fundamental: 0.20,
        newsAi: 0.25,
        announcements: 0.15,
        marketContext: 0.10
    };

    static RISK_PENALTIES = {
        lowLiquidity: 8,
        wideSpread: 5,
        highVolatility: 4,
        nearCircuit: 6
    };

    // ✅ NEW: Blue-chip whitelist for auto-trading
    static BLUE_CHIPS = new Set([
        'OGDC', 'PPL', 'POL', 'MARI', 'HUBC', 'ENGRO', 'EFERT', 'FATIMA',
        'FFC', 'LUCK', 'MLCF', 'DGKC', 'PSO', 'ATRL', 'HCAR', 'MEBL',
        'MCB', 'HBL', 'UBL', 'BAFL', 'LCI', 'AGP', 'SEARL', 'GLAXO',
        'NATF', 'ABOT', 'COLG', 'PNSC', 'SAZEW', 'SRVI', 'GHNI', 'LOADS',
        'PIOC', 'BIPL', 'THALL', 'PNSC', 'DCR', 'BFBIO'
    ]);

    // ✅ NEW: Quality gate thresholds
    static QUALITY_GATES = {
        minPrice: 20,           // No penny stocks
        minVolume: 50000,       // Minimum daily volume
        maxSpreadPercent: 3.0,  // (high-low)/price must be < 3%
        minRiskReward: 2.0,     // Minimum R:R to show signal (raised from 1.5 — see notes)
        minRiskRewardAuto: 2.0, // Minimum R:R for auto-trade
        minScoreAuto: 15,       // Higher threshold for auto
        minStopPercent: {       // Minimum stop distance
            blueChip: 1.5,
            standard: 2.5
        }
    };

    constructor() {
        this.signals = [];
        this.marketOpenTime = { hour: 9, minute: 32 };
        this.preOpenStart = { hour: 9, minute: 15 };
        this.marketCloseTime = { hour: 15, minute: 30 };
    }

    isMarketOpen() {
        const now = new Date();
        const pkTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
        const hours = pkTime.getHours();
        const minutes = pkTime.getMinutes();
        const day = pkTime.getDay();
        if (day === 0 || day === 6) return false;
        if (day === 5 && (hours > 15 || (hours === 15 && minutes >= 30))) return false;
        const marketOpen = hours > 9 || (hours === 9 && minutes >= 32);
        const marketClose = hours < 15 || (hours === 15 && minutes <= 30);
        return marketOpen && marketClose;
    }

    formatVol(v) {
        if (!v) return '0';
        if (v >= 1000000) return (v/1000000).toFixed(1) + 'M';
        if (v >= 1000) return (v/1000).toFixed(0) + 'K';
        return v.toString();
    }

    // ✅ NEW: Market regime check
    isMarketHealthy(marketIndex) {
        if (!marketIndex) return true;
        // Don't trade if KSE-100 is down > 1.5%
        if (marketIndex.changePercent < -1.5) return false;
        // Don't trade if > 70% stocks are declining
        if (marketIndex.decliners && marketIndex.advancers) {
            const total = marketIndex.advancers + marketIndex.decliners;
            if (total > 0 && (marketIndex.decliners / total) > 0.70) return false;
        }
        return true;
    }

    // ✅ NEW: Quality gate filter
    passesQualityGate(stock, marketIndex) {
        const g = this.constructor.QUALITY_GATES;
        const reasons = [];
        let passed = true;

        // Price gate
        if (stock.price < g.minPrice) {
            reasons.push(`Price Rs.${stock.price} < min Rs.${g.minPrice}`);
            passed = false;
        }

        // Volume gate
        if (stock.volume < g.minVolume) {
            reasons.push(`Volume ${this.formatVol(stock.volume)} < min ${this.formatVol(g.minVolume)}`);
            passed = false;
        }

        // Spread gate (intraday volatility)
        if (stock.high > 0 && stock.low > 0) {
            const spread = ((stock.high - stock.low) / stock.price) * 100;
            if (spread > g.maxSpreadPercent) {
                reasons.push(`Spread ${spread.toFixed(1)}% > max ${g.maxSpreadPercent}%`);
                passed = false;
            }
        }

        // Market regime gate
        if (!this.isMarketHealthy(marketIndex)) {
            reasons.push('Market in downtrend');
            passed = false;
        }

        // Trend gate: price should be above the daily pivot (proxy for trend —
        // ema20 is never present on the stock objects server.js builds, so this
        // used to silently never trigger)
        if (stock.pivot && stock.pivot > 0 && stock.price < stock.pivot * 0.98) {
            reasons.push(`Price below pivot`);
            passed = false;
        }

        return { passed, reasons };
    }

    // ✅ NEW: Smart stop loss calculation
    calculateSmartStop(stock, entryPrice, isBlueChip) {
        const g = this.constructor.QUALITY_GATES;
        const minStopPct = isBlueChip ? g.minStopPercent.blueChip : g.minStopPercent.standard;

        // 1. Support-based stop
        let stop = entryPrice * 0.97; // default 3%

        const hasValidS1 = stock.s1 && stock.s1 > 0 && stock.s1 < entryPrice;
        const hasValidS2 = stock.s2 && stock.s2 > 0 && stock.s2 < stock.s1;

        if (hasValidS2 && stock.s2 < entryPrice * 0.99) {
            stop = stock.s2 * 0.995; // S2 minus 0.5% buffer
        } else if (hasValidS1 && stock.s1 < entryPrice * 0.995) {
            stop = stock.s1 * 0.99;  // S1 minus 1% buffer
        }

        // 2. Minimum % stop (prevents ultra-tight stops)
        const minStopPrice = entryPrice * (1 - minStopPct / 100);
        if (stop > minStopPrice) {
            stop = minStopPrice;
        }

        // 3. ATR-based stop (if ATR data available)
        if (stock.atr14 && stock.atr14 > 0) {
            const atrStop = entryPrice - (1.5 * stock.atr14);
            if (atrStop < stop) {
                stop = atrStop;
            }
        }

        return +stop.toFixed(2);
    }

    // ✅ NEW: Smart target calculation
    calculateSmartTarget(stock, entryPrice, stopPrice, minRR) {
        const risk = entryPrice - stopPrice;
        if (risk <= 0) return null;

        // Use R1 if available and gives good R:R
        let target = entryPrice + (risk * minRR);

        const hasValidR1 = stock.r1 && stock.r1 > 0 && stock.r1 > entryPrice;
        const hasValidR2 = stock.r2 && stock.r2 > 0 && stock.r2 > stock.r1;

        if (hasValidR2 && stock.r2 > target) {
            target = stock.r2 * 0.995;
        } else if (hasValidR1 && stock.r1 > target * 0.95) {
            target = stock.r1;
        }

        return +target.toFixed(2);
    }

    generateSignals(stocks, newsData, announcements, marketIndex = null, institutionalSignals = {}, orderFlowRatios = {}) {
        if (!stocks || !stocks.length) return [];
        const signals = [];
        const marketOpen = this.isMarketOpen();

        for (const stock of stocks) {
            let score = 0;
            const reasons = [];
            const type = [];
            const isBlueChip = this.constructor.BLUE_CHIPS.has(stock.symbol);

            // ✅ QUALITY GATE (NEW)
            const quality = this.passesQualityGate(stock, marketIndex);
            if (!quality.passed) {
                // Skip entirely — don't even show in frontend
                continue;
            }

            // Skip stocks with no proper price data
            if (!stock.price || stock.price <= 0) continue;

            // ==================== SCORING (REVISED) ====================

            // Technical Analysis — REDUCED RSI weight, added confluence requirement
            if (stock.rsi < 30) { 
                score += 5; reasons.push('Oversold (RSI)'); 
            }
            else if (stock.rsi < 40) { 
                score += 2; reasons.push('Near oversold'); 
            }
            else if (stock.rsi > 70) { 
                score -= 5; reasons.push('Overbought (RSI)'); 
            }
            else if (stock.rsi > 60) { 
                score -= 2; reasons.push('Near overbought'); 
            }

            // Support & Resistance — require confluence with trend
            const hasValidS1 = stock.s1 && stock.s1 > 0 && stock.s1 < stock.price;
            const hasValidS2 = stock.s2 && stock.s2 > 0 && stock.s2 < stock.s1;
            const hasValidR1 = stock.r1 && stock.r1 > 0 && stock.r1 > stock.price;
            const hasValidR2 = stock.r2 && stock.r2 > 0 && stock.r2 > stock.r1;

            // Only give support points if price is in uptrend or flat (pivot-based
            // proxy — ema20 is never populated, so this used to always evaluate true)
            const inUptrend = !stock.pivot || stock.price >= stock.pivot;

            if (hasValidS1 && stock.price <= stock.s1 * 1.02 && inUptrend) {
                score += 4; reasons.push('At support S1 + trend');
            }
            if (hasValidS2 && stock.price <= stock.s2 * 1.02 && stock.price >= stock.s2 * 0.98 && inUptrend) {
                score += 6; reasons.push('At strong support S2 + trend');
            }
            if (hasValidR1 && stock.price >= stock.r1 * 0.98) {
                score -= 3; reasons.push('Near resistance R1');
            }

            // Volume Analysis — stricter thresholds
            const volRatio = stock.volAvg10d ? stock.volume / stock.volAvg10d : 1;
            if (volRatio > 3) { 
                score += 4; reasons.push(`High vol (${volRatio.toFixed(1)}x)`); 
            }
            else if (volRatio > 2) { 
                score += 2; reasons.push('Above avg volume'); 
            }

            // Price Momentum — require alignment
            if (stock.changePercent > 3 && inUptrend) { 
                score += 3; reasons.push('Strong momentum + trend'); 
            }
            else if (stock.changePercent < -3) { 
                score -= 3; reasons.push('Weak momentum'); 
            }

            // Fundamental Analysis
            if (stock.pe > 0 && stock.pe < 10) { score += 3; reasons.push('Low PE'); }
            if (stock.eps > 10) { score += 2; reasons.push('Strong EPS'); }
            if (stock.divYield > 5) { score += 2; reasons.push(`High yield ${stock.divYield.toFixed(1)}%`); }

            // News & AI Analysis
            if (newsData && newsData.topTrades) {
                const tradeMatch = newsData.topTrades.find(t => t.ticker === stock.symbol);
                if (tradeMatch) {
                    if (tradeMatch.action === 'BUY') { score += 4; reasons.push('AI: BUY'); }
                    else if (tradeMatch.action === 'SELL') { score -= 4; reasons.push('AI: SELL'); }
                }
            }

            // Announcements
            if (announcements && announcements.announcements) {
                const stockAnn = announcements.announcements.find(a => a.symbol === stock.symbol);
                if (stockAnn) {
                    if (stockAnn.score > 5) { score += 5; reasons.push(`${stockAnn.typeIcon} Positive`); }
                    else if (stockAnn.score > 2) { score += 2; reasons.push(`${stockAnn.typeIcon} Good`); }
                    else if (stockAnn.score < -3) { score -= 3; reasons.push(`${stockAnn.typeIcon} Negative`); }
                }
            }

            // ✅ Trend bonus/penalty (pivot-based proxy)
            if (stock.pivot && stock.pivot > 0) {
                const trendStrength = (stock.price - stock.pivot) / stock.pivot * 100;
                if (trendStrength > 2) { score += 3; reasons.push('Above pivot'); }
                else if (trendStrength < -3) { score -= 4; reasons.push('Below pivot'); }
            }

            // ✅ NEW: Blue-chip bonus (quality premium)
            if (isBlueChip) { score += 2; reasons.push('Blue-chip quality'); }

            // ✅ NEW: Confluence with institutional tracker
            const instData = institutionalSignals[stock.symbol];
            if (instData) {
                if (instData.signal === 'STRONG_INSTITUTIONAL_BUY') { score += 5; reasons.push('🐋🐋 Institutional strong buy'); }
                else if (instData.signal === 'INSTITUTIONAL_BUY' || instData.signal === 'BUILDING') { score += 3; reasons.push('🐋 Institutional buying'); }
                else if (instData.signal === 'DISTRIBUTION') { score -= 5; reasons.push('🔴 Institutional distribution — conflict'); }
                else if (instData.signal === 'WEAKENING') { score -= 3; reasons.push('📉 Institutional weakening — conflict'); }
            }

            // ✅ NEW: Confluence with order-flow tracker
            const flowRatio = orderFlowRatios[stock.symbol];
            if (flowRatio !== undefined) {
                if (flowRatio > 60) { score += 3; reasons.push(`Order flow buy-heavy (${flowRatio}%)`); }
                else if (flowRatio > 55) { score += 1; reasons.push('Order flow mildly buy-heavy'); }
                else if (flowRatio < 40) { score -= 3; reasons.push(`Order flow sell-heavy (${flowRatio}%)`); }
                else if (flowRatio < 45) { score -= 1; reasons.push('Order flow mildly sell-heavy'); }
            }

            // Trade Type Determination
            if (volRatio > 2 && Math.abs(stock.changePercent) > 2) type.push('DAY');
            if (stock.rsi < 45 && stock.pe < 15 && stock.divYield > 0 && inUptrend) type.push('SWING');
            if (score >= 10) { 
                if (!type.includes('DAY')) type.push('DAY'); 
                if (!type.includes('SWING')) type.push('SWING'); 
            }

            // ==================== TARGET & STOP (SMART) ====================
            const entry = stock.price;
            const stop = this.calculateSmartStop(stock, entry, isBlueChip);
            const target = this.calculateSmartTarget(stock, entry, stop, this.constructor.QUALITY_GATES.minRiskReward);

            if (!target || target <= entry) {
                continue; // Invalid setup
            }

            const potentialGain = target - entry;
            const potentialLoss = entry - stop;
            let riskReward = 0;

            if (potentialLoss > 0 && potentialGain > 0) {
                riskReward = +(potentialGain / potentialLoss).toFixed(1);
            }

            // ✅ STRICT R:R GATE
            if (riskReward < this.constructor.QUALITY_GATES.minRiskReward) {
                continue;
            }

            // Signal Classification
            let signal, color, emoji;
            if (score >= 14) { signal = 'STRONG_BUY'; color = '#22c55e'; emoji = '🟢🟢'; }
            else if (score >= 9) { signal = 'BUY'; color = '#4ade80'; emoji = '🟢'; }
            else if (score >= 5) { signal = 'WEAK_BUY'; color = '#84cc16'; emoji = '🟡'; }
            else if (score <= -8) { signal = 'STRONG_SELL'; color = '#ef4444'; emoji = '🔴🔴'; }
            else if (score <= -4) { signal = 'SELL'; color = '#f87171'; emoji = '🔴'; }
            else { signal = 'NEUTRAL'; color = '#94a3b8'; emoji = '⚪'; }

            // ✅ FINAL GATE: Only show signals with conviction + valid levels + good R:R
            const isAutoTradable = isBlueChip && 
                                   score >= this.constructor.QUALITY_GATES.minScoreAuto &&
                                   riskReward >= this.constructor.QUALITY_GATES.minRiskRewardAuto &&
                                   stock.volume >= 100000;

            if ((type.length > 0 || Math.abs(score) >= 6) && riskReward >= 1.0) {
                signals.push({
                    symbol: stock.symbol,
                    name: stock.name,
                    price: stock.price,
                    change: stock.changePercent,
                    volume: stock.volume,
                    rsi: stock.rsi,
                    pe: stock.pe,
                    signal,
                    emoji,
                    color,
                    score,
                    reasons: reasons.slice(0, 5),
                    tradeType: type.length > 0 ? type.join(' | ') : (score > 0 ? 'SWING' : 'AVOID'),
                    entryPrice: stock.price,
                    targetPrice: target,
                    stopLoss: stop,
                    riskReward,
                    riskLevel: score > 12 ? 'LOW' : score > 7 ? 'MEDIUM' : 'HIGH',
                    marketStatus: marketOpen ? 'MARKET_OPEN' : 'MARKET_CLOSED',
                    isBlueChip,
                    autoTradeEligible: isAutoTradable,
                    qualityPassed: true
                });
            }
        }

        // Sort by score (absolute) and then by risk/reward
        signals.sort((a, b) => {
            const scoreDiff = Math.abs(b.score) - Math.abs(a.score);
            if (Math.abs(scoreDiff) < 2) {
                return b.riskReward - a.riskReward;
            }
            return scoreDiff;
        });

        return signals;
    }

    // Helper methods (unchanged)
    getTechnicalScore(stock) {
        let score = 50;
        if (stock.rsi < 30) score += 15;
        else if (stock.rsi < 40) score += 8;
        else if (stock.rsi > 70) score -= 15;
        else if (stock.rsi > 60) score -= 5;

        if (stock.s1 && stock.price <= stock.s1 * 1.02) score += 8;
        if (stock.r1 && stock.price >= stock.r1 * 0.98) score -= 10;

        return Math.max(0, Math.min(100, score));
    }

    getFundamentalScore(stock) {
        let score = 50;
        if (stock.pe > 0 && stock.pe < 10) score += 15;
        if (stock.eps > 10) score += 10;
        if (stock.divYield > 5) score += 10;
        return Math.max(0, Math.min(100, score));
    }

    getNewsAiScore(stock, newsData) {
        if (!newsData?.topTrades) return 50;
        const trade = newsData.topTrades.find(t => t.ticker === stock.symbol);
        if (!trade) return 50;
        return trade.action === 'BUY' ? 75 : trade.action === 'SELL' ? 25 : 50;
    }

    getAnnouncementScore(stock, announcements) {
        if (!announcements?.announcements) return 50;
        const ann = announcements.announcements.find(a => a.symbol === stock.symbol);
        if (!ann) return 50;
        return 50 + (ann.score * 4);
    }

    // ✅ Pre-market gap scanner
    isPreOpenWindow() {
        const now = new Date();
        const pkTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
        const h = pkTime.getHours(), m = pkTime.getMinutes();
        const afterStart = h > this.preOpenStart.hour || (h === this.preOpenStart.hour && m >= this.preOpenStart.minute);
        const beforeOpen = h < this.marketOpenTime.hour || (h === this.marketOpenTime.hour && m < this.marketOpenTime.minute);
        return afterStart && beforeOpen;
    }

    analyzePreMarket(stocks) {
        if (!stocks || !stocks.length) return [];
        const gates = this.constructor.QUALITY_GATES;
        return stocks
            .filter(s => s.price > 0 && s.volume >= gates.minVolume && Math.abs(s.changePercent || 0) >= 2)
            .map(s => ({
                symbol: s.symbol,
                name: s.name,
                price: s.price,
                gapPercent: s.changePercent,
                volume: s.volume,
                direction: s.changePercent > 0 ? 'GAP_UP' : 'GAP_DOWN',
                isBlueChip: this.constructor.BLUE_CHIPS.has(s.symbol)
            }))
            .sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent))
            .slice(0, 20);
    }

    analyzePreMarketSession(stocks) {
        const signals = this.analyzePreMarket(stocks);
        return {
            isPreMarket: this.isPreOpenWindow(),
            message: signals.length ? `${signals.length} gap movers detected` : 'No significant gaps yet',
            signals
        };
    }

    /**
     * 🔥 AUTO-TRADE SIGNAL EXTRACTOR
     * Returns only signals eligible for automatic execution
     */
    getAutoTradeSignals(stocks, newsData, announcements, marketIndex = null) {
        const allSignals = this.generateSignals(stocks, newsData, announcements, marketIndex);
        return allSignals.filter(s => s.autoTradeEligible);
    }
}

module.exports = new TradingSignalService();