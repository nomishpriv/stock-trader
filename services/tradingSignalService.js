'use strict';

class TradingSignalService {
    // ============ CONFIGURABLE WEIGHTS (0-100 scale) ============
    static SIGNAL_WEIGHTS = {
        technical: 0.30,      // RSI, S/R, volume, momentum
        fundamental: 0.20,    // PE, EPS, div yield
        newsAi: 0.25,         // News sentiment, AI trades
        announcements: 0.15,  // Earnings, dividends, board meetings
        marketContext: 0.10   // Index trend, time-of-day
    };

    static RISK_PENALTIES = {
        lowLiquidity: 8,      // volume < 30% of 10d avg
        wideSpread: 5,        // spread > 1.5%
        highVolatility: 4,    // |change| > 6% (already moved too much)
        nearCircuit: 6        // within 2% of upper/lower circuit
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
        const day = pkTime.getDay();
        const hours = pkTime.getHours();
        const minutes = pkTime.getMinutes();
        const timeInMinutes = hours * 60 + minutes;

        if (day === 0 || day === 6) return false;

        // Friday: 9:32-12:00 and 14:32-16:30
        if (day === 5) {
            const s1Start = 9 * 60 + 32;
            const s1End   = 12 * 60;
            const s2Start = 14 * 60 + 32;
            const s2End   = 16 * 60 + 30;
            return (timeInMinutes >= s1Start && timeInMinutes <= s1End) ||
                   (timeInMinutes >= s2Start && timeInMinutes <= s2End);
        }

        // Mon-Thu: 9:32 - 15:30
        const start = 9 * 60 + 32;
        const end   = 15 * 60 + 30;
        return timeInMinutes >= start && timeInMinutes <= end;
    }

    isPreOpenSession() {
        const now = new Date();
        const pkTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
        const hours = pkTime.getHours();
        const minutes = pkTime.getMinutes();
        const day = pkTime.getDay();
        if (day === 0 || day === 6) return false;
        return (hours === 9 && minutes >= 15 && minutes < 32);
    }

    isMarketClosed() {
        return !this.isMarketOpen() && !this.isPreOpenSession();
    }

    formatVol(v) {
        if (!v) return '0';
        if (v >= 1000000) return (v/1000000).toFixed(1) + 'M';
        if (v >= 1000) return (v/1000).toFixed(0) + 'K';
        return v.toString();
    }

    generateSignals(stocks, newsData, announcements) {
        if (!stocks || !stocks.length) return [];
        const signals = [];
        const marketOpen = this.isMarketOpen();
        const marketStatus = marketOpen ? 'MARKET_OPEN' : 'MARKET_CLOSED';

        // Market context: KSE-100 trend (if available)
        const avgMarketChange = stocks.reduce((s, st) => s + (st.changePercent || 0), 0) / stocks.length;

        for (const stock of stocks) {
            const components = {
                technical: this.scoreTechnical(stock),
                fundamental: this.scoreFundamental(stock),
                newsAi: this.scoreNewsAi(stock, newsData),
                announcements: this.scoreAnnouncements(stock, announcements),
                marketContext: this.scoreMarketContext(stock, avgMarketChange, marketStatus)
            };

            // Base weighted score (0-100)
            let baseScore = 0;
            for (const [key, weight] of Object.entries(TradingSignalService.SIGNAL_WEIGHTS)) {
                baseScore += (components[key] || 50) * weight;
            }
            baseScore = Math.max(0, Math.min(100, baseScore));

            // Risk penalties (reduce confidence, not raw score)
            let riskPenalty = 0;
            const penalties = [];
            const volRatio = stock.volAvg10d ? stock.volume / stock.volAvg10d : 1;

            if (volRatio < 0.3) {
                riskPenalty += TradingSignalService.RISK_PENALTIES.lowLiquidity;
                penalties.push('Low liquidity');
            }
            if (stock.spreadPercent > 1.5) {
                riskPenalty += TradingSignalService.RISK_PENALTIES.wideSpread;
                penalties.push('Wide spread');
            }
            if (Math.abs(stock.changePercent) > 6) {
                riskPenalty += TradingSignalService.RISK_PENALTIES.highVolatility;
                penalties.push('High intraday volatility');
            }
            if (stock.upperCircuit && stock.price >= stock.upperCircuit * 0.98) {
                riskPenalty += TradingSignalService.RISK_PENALTIES.nearCircuit;
                penalties.push('Near upper circuit');
            }
            if (stock.lowerCircuit && stock.price <= stock.lowerCircuit * 1.02) {
                riskPenalty += TradingSignalService.RISK_PENALTIES.nearCircuit;
                penalties.push('Near lower circuit');
            }

            // Adjusted confidence = baseScore diluted by risk
            const confidence = Math.max(10, Math.min(95, baseScore - riskPenalty));

            // Determine signal from confidence + direction
            let signal, color, emoji, tradeType;
            const isBullish = confidence > 50;

            if (confidence >= 75) {
                signal = isBullish ? 'STRONG_BUY' : 'STRONG_SELL';
                color = isBullish ? '#22c55e' : '#ef4444';
                emoji = isBullish ? '🟢🟢' : '🔴🔴';
            } else if (confidence >= 60) {
                signal = isBullish ? 'BUY' : 'SELL';
                color = isBullish ? '#4ade80' : '#f87171';
                emoji = isBullish ? '🟢' : '🔴';
            } else if (confidence >= 45) {
                signal = isBullish ? 'WEAK_BUY' : 'WEAK_SELL';
                color = isBullish ? '#84cc16' : '#f97316';
                emoji = isBullish ? '🟡' : '🟠';
            } else {
                signal = 'NEUTRAL';
                color = '#94a3b8';
                emoji = '⚪';
            }

            // Trade type logic
            const types = [];
            if (volRatio > 1.5 && Math.abs(stock.changePercent) > 2) types.push('DAY');
            if (components.fundamental > 60 && components.technical > 50) types.push('SWING');
            if (confidence >= 65 && !types.length) types.push('SWING');
            tradeType = types.length ? types.join(' | ') : 'WATCH';

            // Technical levels
            const target = stock.r1 ? stock.r1 : stock.price * 1.03;
            const stop = stock.s1 ? stock.s1 : stock.price * 0.97;
            const riskReward = stop !== stock.price && stop !== 0
                ? +((Math.abs(target - stock.price) / Math.abs(stock.price - stop)).toFixed(1))
                : 0;

            // Build reasons from top contributing factors
            const reasons = this.buildReasons(components, stock, volRatio);

            if (Math.abs(confidence - 50) >= 8) { // Only emit if there's a real edge
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
                    score: Math.round(confidence),
                    rawScore: Math.round(baseScore),
                    riskPenalty,
                    reasons: reasons.slice(0, 5),
                    tradeType,
                    entryPrice: stock.price,
                    targetPrice: +target.toFixed(2),
                    stopLoss: +stop.toFixed(2),
                    riskReward,
                    riskLevel: confidence > 75 ? 'LOW' : confidence > 60 ? 'MEDIUM' : 'HIGH',
                    marketStatus,
                    penalties: penalties.slice(0, 3),
                    components // transparent breakdown
                });
            }
        }

        signals.sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));
        return signals;
    }

    // ─── COMPONENT SCORERS (each returns 0-100) ───

    scoreTechnical(stock) {
        let score = 50; // neutral base
        const reasons = [];

        // RSI (0-30 scale, centered at 50)
        const rsi = stock.rsi || 50;
        if (rsi < 20) { score += 18; reasons.push('Deeply oversold'); }
        else if (rsi < 30) { score += 12; reasons.push('Oversold'); }
        else if (rsi < 40) { score += 6; reasons.push('Near oversold'); }
        else if (rsi > 80) { score -= 18; reasons.push('Deeply overbought'); }
        else if (rsi > 70) { score -= 12; reasons.push('Overbought'); }
        else if (rsi > 60) { score -= 6; reasons.push('Near overbought'); }

        // Support / Resistance proximity
        if (stock.s2 && stock.price <= stock.s2 * 1.01 && stock.price >= stock.s2 * 0.98) {
            score += 10; reasons.push('At strong support S2');
        } else if (stock.s1 && stock.price <= stock.s1 * 1.01 && stock.price >= stock.s1 * 0.98) {
            score += 7; reasons.push('At support S1');
        }
        if (stock.r2 && stock.price >= stock.r2 * 0.99) {
            score -= 10; reasons.push('At strong resistance R2');
        } else if (stock.r1 && stock.price >= stock.r1 * 0.99) {
            score -= 7; reasons.push('At resistance R1');
        }

        // Volume confirmation
        const volRatio = stock.volAvg10d ? stock.volume / stock.volAvg10d : 1;
        if (volRatio > 3) { score += 8; reasons.push('Extreme volume (>3x)'); }
        else if (volRatio > 2) { score += 5; reasons.push('High volume (2x)'); }
        else if (volRatio > 1.3) { score += 3; reasons.push('Above avg volume'); }
        else if (volRatio < 0.4) { score -= 5; reasons.push('Low volume'); }

        // Price momentum (mean-reversion for extremes)
        const ch = stock.changePercent || 0;
        if (ch > 5) { score -= 4; reasons.push('Overextended up'); }
        else if (ch > 3) { score -= 2; reasons.push('Strong up move'); }
        else if (ch < -5) { score += 4; reasons.push('Overextended down'); }
        else if (ch < -3) { score += 2; reasons.push('Strong down move'); }

        // Bollinger / position within range (if available)
        if (stock.low > 0 && stock.high > 0) {
            const rangePos = (stock.price - stock.low) / (stock.high - stock.low || 1);
            if (rangePos < 0.1) { score += 5; reasons.push('Near day low'); }
            else if (rangePos > 0.9) { score -= 5; reasons.push('Near day high'); }
        }

        return Math.max(0, Math.min(100, score));
    }

    scoreFundamental(stock) {
        let score = 50;
        const pe = stock.pe || 0;
        const eps = stock.eps || 0;
        const divYield = stock.divYield || 0;

        // PE scoring (lower is better for value, but < 3 is suspicious)
        if (pe > 3 && pe < 8) score += 12;
        else if (pe >= 8 && pe < 12) score += 8;
        else if (pe >= 12 && pe < 18) score += 4;
        else if (pe >= 30 && pe < 50) score -= 4;
        else if (pe >= 50 || pe < 0) score -= 8; // negative PE = losses

        // EPS strength
        if (eps > 20) score += 8;
        else if (eps > 10) score += 5;
        else if (eps > 5) score += 3;
        else if (eps < 0) score -= 6;

        // Dividend yield (higher = defensive value)
        if (divYield > 8) score += 10;
        else if (divYield > 5) score += 6;
        else if (divYield > 3) score += 3;

        return Math.max(0, Math.min(100, score));
    }

    scoreNewsAi(stock, newsData) {
        if (!newsData || !newsData.topTrades) return 50;
        const tradeMatch = newsData.topTrades.find(t => t.ticker === stock.symbol);
        if (!tradeMatch) return 50;

        if (tradeMatch.action === 'BUY') return 72;
        if (tradeMatch.action === 'SELL') return 28;
        return 50;
    }

    scoreAnnouncements(stock, announcements) {
        if (!announcements || !announcements.announcements) return 50;
        const ann = announcements.announcements.find(a => a.symbol === stock.symbol);
        if (!ann) return 50;

        // Map announcement score (-10 to +10) to 0-100
        const annScore = ann.score || 0;
        return 50 + (annScore * 4); // -10→10, +10→90, 0→50
    }

    scoreMarketContext(stock, avgMarketChange, marketStatus) {
        let score = 50;
        if (marketStatus === 'MARKET_CLOSED') return 50; // no context when closed

        // Relative strength vs market
        const relStrength = (stock.changePercent || 0) - avgMarketChange;
        if (relStrength > 2) score += 8;
        else if (relStrength > 1) score += 4;
        else if (relStrength < -2) score -= 8;
        else if (relStrength < -1) score -= 4;

        // Time-of-day bias (if data available)
        const now = new Date();
        const pkTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
        const hour = pkTime.getHours();
        if (hour >= 14) score += 2; // afternoon often has more conviction

        return Math.max(0, Math.min(100, score));
    }

    buildReasons(components, stock, volRatio) {
        const reasons = [];
        const c = components;

        // Only show reasons that actually moved the needle
        if (c.technical > 60) reasons.push('Technical bullish');
        else if (c.technical < 40) reasons.push('Technical bearish');

        if (c.fundamental > 65) reasons.push('Strong fundamentals');
        else if (c.fundamental < 35) reasons.push('Weak fundamentals');

        if (c.newsAi > 60) reasons.push('AI: BUY');
        else if (c.newsAi < 40) reasons.push('AI: SELL');

        if (c.announcements > 65) reasons.push('Positive announcement');
        else if (c.announcements < 35) reasons.push('Negative announcement');

        if (volRatio > 2) reasons.push(`Volume ${volRatio.toFixed(1)}x avg`);

        return reasons;
    }

    /**
     * Pre-Market Scanner for PSX
     * During pre-open: Analyzes order book for opening predictions
     * When market closed: Shows stocks with bullish potential for next session
     */
    async analyzePreMarket(stocks, orderBookService) {
        const preMarketSignals = [];
        const isPreOpen = this.isPreOpenSession();
        const marketClosed = this.isMarketClosed();

        if (marketClosed) {
            for (const stock of stocks) {
                const score = { total: 0, reasons: [] };
                if (stock.changePercent > 3) { score.total += 4; score.reasons.push('Strong last close'); }
                else if (stock.changePercent > 1) { score.total += 2; score.reasons.push('Positive last close'); }
                if (stock.rsi < 35) { score.total += 3; score.reasons.push('Oversold - bounce likely'); }
                if (stock.rsi > 40 && stock.rsi < 55 && stock.changePercent > 0) { 
                    score.total += 2; score.reasons.push('RSI momentum building'); 
                }
                const volRatio = stock.volAvg10d ? stock.volume / stock.volAvg10d : 1;
                if (volRatio > 2) { score.total += 3; score.reasons.push('High volume breakout'); }
                if (stock.s1 && stock.price <= stock.s1 * 1.03 && stock.price >= stock.s1 * 0.97) {
                    score.total += 3; score.reasons.push('Near support - good entry');
                }
                if (stock.high > 0 && stock.low > 0) {
                    const closePosition = ((stock.price - stock.low) / (stock.high - stock.low)) * 100;
                    if (closePosition > 80) { score.total += 2; score.reasons.push('Closed near high'); }
                }
                if (score.total >= 5) {
                    const gapPercent = stock.open > 0 ? ((stock.price - stock.open) / stock.open * 100).toFixed(1) : 0;
                    preMarketSignals.push({
                        symbol: stock.symbol, name: stock.name, price: stock.price,
                        open: stock.open, high: stock.high, low: stock.low,
                        gapPercent: +gapPercent, volume: stock.volume, rsi: stock.rsi,
                        score: score.total, reasons: score.reasons,
                        expectedOpen: +(stock.price * (1 + (score.total / 200))).toFixed(2),
                        confidence: Math.min(85, score.total * 10 + 20),
                        sessionType: 'NEXT_SESSION',
                        note: 'Potential mover for next trading session',
                    });
                }
            }
        } else if (isPreOpen) {
            for (const stock of stocks.slice(0, 100)) {
                const score = { total: 0, reasons: [] };
                if (stock.changePercent > 2) { score.total += 3; score.reasons.push('Bullish previous close'); }
                try {
                    const cached = orderBookService ? orderBookService.getCachedOrderBook(stock.symbol) : null;
                    if (cached) {
                        if (cached.bidAskRatio > 1.3) { score.total += 4; score.reasons.push(`Buy orders dominate (${cached.bidAskRatio})`); }
                        if (cached.imbalance > 15) { score.total += 3; score.reasons.push(`Buy imbalance ${cached.imbalance}%`); }
                        if (cached.largeOrders?.some(o => o.type === 'BID' && o.impact === 'HIGH')) {
                            score.total += 5; score.reasons.push('Large buy order in pre-open'); 
                        }
                        if (cached.spreadPercent < 0.5) { score.total += 1; score.reasons.push('Tight spread'); }
                    }
                } catch (e) {}
                if (stock.upperCircuit && stock.price >= stock.upperCircuit * 0.93) {
                    score.total += 3; score.reasons.push('Near upper circuit');
                }
                if (score.total >= 5) {
                    preMarketSignals.push({
                        symbol: stock.symbol, name: stock.name, price: stock.price,
                        open: stock.open,
                        gapPercent: stock.open > 0 ? +((stock.price - stock.open) / stock.open * 100).toFixed(1) : 0,
                        volume: stock.volume, score: score.total, reasons: score.reasons,
                        expectedOpen: +(stock.price * 1.02).toFixed(2),
                        confidence: Math.min(90, score.total * 12),
                        sessionType: 'PRE_OPEN',
                        note: 'Strong pre-open demand - likely to gap up at open',
                    });
                }
            }
        } else {
            for (const stock of stocks.slice(0, 100)) {
                const score = { total: 0, reasons: [] };
                const volRatio = stock.volAvg10d ? stock.volume / stock.volAvg10d : 0;
                if (volRatio > 1.5 && stock.changePercent > 1) {
                    score.total += 4; score.reasons.push('Volume breakout in progress');
                }
                if (stock.price >= stock.r1 * 0.99) {
                    score.total += 3; score.reasons.push('Breaking resistance');
                }
                if (stock.rsi > 50 && stock.rsi < 65 && stock.changePercent > 0) {
                    score.total += 2; score.reasons.push('RSI momentum');
                }
                if (score.total >= 5) {
                    preMarketSignals.push({
                        symbol: stock.symbol, name: stock.name, price: stock.price,
                        gapPercent: stock.open > 0 ? +((stock.price - stock.open) / stock.open * 100).toFixed(1) : 0,
                        score: score.total, reasons: score.reasons,
                        expectedOpen: +(stock.price * 1.01).toFixed(2),
                        confidence: Math.min(85, score.total * 10 + 15),
                        sessionType: 'INTRADAY',
                        note: 'Intraday breakout candidate',
                    });
                }
            }
        }
        preMarketSignals.sort((a, b) => b.score - a.score);
        return preMarketSignals.slice(0, 20);
    }

    /**
     * 🔥 Dedicated Pre-Market Analysis Button
     * Only works during 9:15-9:30 AM
     * Fetches order books, analyzes depth, and gives BUY/SELL signals with entry/exit
     */
    async analyzePreMarketSession(stocks, orderBookService) {
        const now = new Date();
        const pkTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
        const hours = pkTime.getHours();
        const minutes = pkTime.getMinutes();
        const day = pkTime.getDay();

        // Strict pre-market check: 9:15-9:32 AM, Mon-Thu (1-4) and Fri (5)
        const isPreMarket = (hours === 9 && minutes >= 15 && minutes < 32) && (day >= 1 && day <= 5);
        
        if (!isPreMarket) {
            return {
                isPreMarket: false,
                message: hours < 9 || (hours === 9 && minutes < 15) 
                    ? '⏰ Pre-market starts at 9:15 AM PKT' 
                    : '🔔 Market is now open for trading — Use Signals tab',
                signals: [],
                timeRemaining: null,
                strongBuys: 0,
                buys: 0,
                total: 0,
            };
        }

        const timeRemaining = 32 - minutes;
        const preMarketSignals = [];

        // Fetch order books for top stocks by previous day volume
        const topStocks = stocks.sort((a, b) => b.volume - a.volume).slice(0, 50);

        for (const stock of topStocks) {
            const analysis = {
                symbol: stock.symbol,
                name: stock.name,
                previousClose: stock.price,
                previousChange: stock.changePercent,
                score: 0,
                reasons: [],
                buySignal: false,
                signalStrength: 'SKIP',
                expectedGap: 0,
                confidence: 0,
                suggestedEntry: stock.price,
                suggestedTarget: +(stock.price * 1.02).toFixed(2),
                suggestedStop: +(stock.price * 0.98).toFixed(2),
                riskLevel: 'MEDIUM',
            };

            // 1. Previous day momentum (20%)
            if (stock.changePercent > 3) { analysis.score += 4; analysis.reasons.push('🔥 Strong prev close +' + stock.changePercent.toFixed(1) + '%'); }
            else if (stock.changePercent > 1.5) { analysis.score += 2; analysis.reasons.push('✅ Positive prev close'); }
            else if (stock.changePercent < -2) { analysis.score -= 2; analysis.reasons.push('⚠️ Weak prev close'); }

            // 2. Order book analysis (40%)
            try {
                const cached = orderBookService ? orderBookService.getCachedOrderBook(stock.symbol) : null;
                if (cached) {
                    if (cached.bidAskRatio > 2) { 
                        analysis.score += 8; 
                        analysis.reasons.push(`🚀 Extreme buy pressure (${cached.bidAskRatio.toFixed(1)}x)`); 
                    } else if (cached.bidAskRatio > 1.5) { 
                        analysis.score += 5; 
                        analysis.reasons.push(`📈 Strong buy pressure (${cached.bidAskRatio.toFixed(1)}x)`); 
                    } else if (cached.bidAskRatio > 1.2) { 
                        analysis.score += 2; 
                        analysis.reasons.push('📊 Moderate buy interest'); 
                    }

                    if (cached.imbalance > 25) { analysis.score += 5; analysis.reasons.push(`💪 Heavy buy imbalance ${cached.imbalance}%`); }
                    else if (cached.imbalance > 15) { analysis.score += 3; analysis.reasons.push(`👍 Buy imbalance ${cached.imbalance}%`); }

                    const largeBids = (cached.largeOrders || []).filter(o => o.type === 'BID');
                    if (largeBids.length > 0) {
                        const totalLargeBidVol = largeBids.reduce((s, o) => s + o.volume, 0);
                        analysis.score += Math.min(6, largeBids.length * 2);
                        analysis.reasons.push(`🐋 ${largeBids.length} large buy(s) - ${this.formatVol(totalLargeBidVol)} shares`);
                    }

                    if (cached.spreadPercent < 0.1) { analysis.score += 1; analysis.reasons.push('Tight spread (liquid)'); }
                    else if (cached.spreadPercent > 1) { analysis.score -= 1; analysis.reasons.push('⚠️ Wide spread'); }

                    if (cached.bestAsk > 0 && cached.bestBid > 0) {
                        const midPrice = (cached.bestAsk + cached.bestBid) / 2;
                        analysis.expectedGap = +((midPrice - stock.price) / stock.price * 100).toFixed(2);
                    }
                } else {
                    analysis.reasons.push('⏳ Waiting for order book...');
                }
            } catch (e) {
                analysis.reasons.push('⏳ Order book loading...');
            }

            // 3. Technical setup (25%)
            if (stock.rsi < 35) { analysis.score += 3; analysis.reasons.push('Oversold - bounce likely'); }
            if (stock.rsi > 40 && stock.rsi < 55 && stock.changePercent > 0) { 
                analysis.score += 2; analysis.reasons.push('RSI momentum building'); 
            }
            if (stock.s1 && stock.price <= stock.s1 * 1.02 && stock.price >= stock.s1) {
                analysis.score += 3; analysis.reasons.push('At support level');
            }

            // 4. Circuit limits (15%)
            if (stock.upperCircuit && stock.price >= stock.upperCircuit * 0.95) {
                analysis.score += 4; analysis.reasons.push('🎯 Near upper circuit');
                analysis.riskLevel = 'HIGH';
            }

            // Determine buy signal
            analysis.confidence = Math.min(95, Math.max(10, analysis.score * 8 + 20));
            
            if (analysis.score >= 10) {
                analysis.buySignal = true;
                analysis.signalStrength = 'STRONG_BUY';
                analysis.suggestedEntry = +(stock.price * 1.005).toFixed(2);
                analysis.suggestedTarget = +(stock.price * 1.03).toFixed(2);
                analysis.suggestedStop = +(stock.price * 0.98).toFixed(2);
                analysis.riskLevel = analysis.score >= 15 ? 'LOW' : 'MEDIUM';
            } else if (analysis.score >= 6) {
                analysis.buySignal = true;
                analysis.signalStrength = 'BUY';
                analysis.suggestedEntry = +(stock.price * 1.003).toFixed(2);
                analysis.suggestedTarget = +(stock.price * 1.02).toFixed(2);
                analysis.suggestedStop = +(stock.price * 0.985).toFixed(2);
                analysis.riskLevel = 'MEDIUM';
            } else if (analysis.score >= 3) {
                analysis.buySignal = false;
                analysis.signalStrength = 'WATCH';
                analysis.riskLevel = 'HIGH';
            }

            if (analysis.score >= 3) {
                preMarketSignals.push(analysis);
            }
        }

        preMarketSignals.sort((a, b) => b.score - a.score);

        return {
            isPreMarket: true,
            message: `⚡ Pre-Market Active — ${timeRemaining} min until open`,
            timeRemaining,
            signals: preMarketSignals.slice(0, 15),
            strongBuys: preMarketSignals.filter(s => s.signalStrength === 'STRONG_BUY').length,
            buys: preMarketSignals.filter(s => s.buySignal).length,
            total: preMarketSignals.length,
        };
    }
}

module.exports = new TradingSignalService();