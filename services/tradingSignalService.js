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
        const hours = pkTime.getHours();
        const minutes = pkTime.getMinutes();
        const day = pkTime.getDay();
        
        // Weekend check
        if (day === 0 || day === 6) return false;
        
        // Friday: closes early at 15:30
        if (day === 5 && (hours > 15 || (hours === 15 && minutes >= 30))) return false;
        
        // Regular market hours: 9:32 - 15:30
        const marketOpen = hours > 9 || (hours === 9 && minutes >= 32);
        const marketClose = hours < 15 || (hours === 15 && minutes <= 30);
        return marketOpen && marketClose;
    }

    isPreOpenSession() {
        const now = new Date();
        const pkTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
        const hours = pkTime.getHours();
        const minutes = pkTime.getMinutes();
        const day = pkTime.getDay();
        
        if (day === 0 || day === 6) return false;
        if (day === 5 && hours >= 15) return false;
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

    for (const stock of stocks) {
        let score = 0;
        const reasons = [];
        const type = [];

        // Skip illiquid stocks (very low price or zero volume)
        if (stock.price <= 0.5 || stock.volume < 5000) continue;
        
        // Skip stocks with no proper price data
        if (!stock.price || stock.price <= 0) continue;

        // Technical Analysis
        if (stock.rsi < 30) { score += 8; reasons.push('Oversold (RSI)'); }
        else if (stock.rsi < 40) { score += 4; reasons.push('Near oversold'); }
        else if (stock.rsi > 70) { score -= 5; reasons.push('Overbought (RSI)'); }
        else if (stock.rsi > 60) { score -= 2; reasons.push('Near overbought'); }

        // Support & Resistance - FIXED: Only add if levels are valid
        const hasValidS1 = stock.s1 && stock.s1 > 0 && stock.s1 < stock.price;
        const hasValidS2 = stock.s2 && stock.s2 > 0 && stock.s2 < stock.s1;
        const hasValidR1 = stock.r1 && stock.r1 > 0 && stock.r1 > stock.price;
        const hasValidR2 = stock.r2 && stock.r2 > 0 && stock.r2 > stock.r1;

        if (hasValidS1 && stock.price <= stock.s1 * 1.02) {
            score += 5; reasons.push('At support S1');
        }
        if (hasValidS2 && stock.price <= stock.s2 * 1.02 && stock.price >= stock.s2 * 0.98) {
            score += 7; reasons.push('At strong support S2');
        }
        if (hasValidR1 && stock.price >= stock.r1 * 0.98) {
            score -= 3; reasons.push('Near resistance R1');
        }

        // Volume Analysis
        const volRatio = stock.volAvg10d ? stock.volume / stock.volAvg10d : 1;
        if (volRatio > 2) { score += 3; reasons.push(`High vol (${volRatio.toFixed(1)}x)`); }
        else if (volRatio > 1.5) { score += 2; reasons.push('Above avg volume'); }

        // Price Momentum
        if (stock.changePercent > 3) { score += 2; reasons.push('Strong momentum'); }
        else if (stock.changePercent < -3) { score -= 2; reasons.push('Weak momentum'); }

        // Fundamental Analysis
        if (stock.pe > 0 && stock.pe < 10) { score += 3; reasons.push('Low PE'); }
        if (stock.eps > 10) { score += 2; reasons.push('Strong EPS'); }
        if (stock.divYield > 5) { score += 2; reasons.push(`High yield ${stock.divYield}%`); }

        // News & AI Analysis
        if (newsData && newsData.topTrades) {
            const tradeMatch = newsData.topTrades.find(t => t.ticker === stock.symbol);
            if (tradeMatch) {
                if (tradeMatch.action === 'BUY') { score += 5; reasons.push('AI: BUY'); }
                else if (tradeMatch.action === 'SELL') { score -= 4; reasons.push('AI: SELL'); }
            }
        }

        // Announcements
        if (announcements && announcements.announcements) {
            const stockAnn = announcements.announcements.find(a => a.symbol === stock.symbol);
            if (stockAnn) {
                if (stockAnn.score > 5) { score += 6; reasons.push(`${stockAnn.typeIcon} Positive`); }
                else if (stockAnn.score > 2) { score += 3; reasons.push(`${stockAnn.typeIcon} Good`); }
                else if (stockAnn.score < -3) { score -= 3; reasons.push(`${stockAnn.typeIcon} Negative`); }
            }
        }

        // Trade Type Determination
        if (volRatio > 1.5 && Math.abs(stock.changePercent) > 2) type.push('DAY');
        if (stock.rsi < 45 && stock.pe < 15 && stock.divYield > 0) type.push('SWING');
        if (score >= 8) { 
            if (!type.includes('DAY')) type.push('DAY'); 
            if (!type.includes('SWING')) type.push('SWING'); 
        }

        // Calculate Target and Stop - FIXED
        let target, stop;
        
        // Use valid R1 as target if available and above price
        if (hasValidR1 && stock.r1 > stock.price * 1.005) {
            target = stock.r1;
        } else if (hasValidR2 && stock.r2 > stock.price * 1.01) {
            target = stock.r2;
        } else {
            target = stock.price * 1.03;
        }

        // Use valid S1 as stop if available and below price
        if (hasValidS1 && stock.s1 < stock.price * 0.995) {
            stop = stock.s1;
        } else if (hasValidS2 && stock.s2 < stock.price * 0.99) {
            stop = stock.s2;
        } else {
            stop = stock.price * 0.97;
        }

        // Calculate Risk/Reward - FIXED
        const potentialGain = target - stock.price;
        const potentialLoss = stock.price - stop;
        let riskReward = 0;
        
        if (potentialLoss > 0 && potentialGain > 0) {
            riskReward = +(potentialGain / potentialLoss).toFixed(1);
        } else if (potentialLoss <= 0) {
            // Invalid stop - don't show this signal
            continue;
        }

        // Skip signals with terrible risk/reward
        if (riskReward < 0.5 && score < 10) continue;

        // Signal Classification
        let signal, color, emoji;
        if (score >= 12) { signal = 'STRONG_BUY'; color = '#22c55e'; emoji = '🟢🟢'; }
        else if (score >= 7) { signal = 'BUY'; color = '#4ade80'; emoji = '🟢'; }
        else if (score >= 3) { signal = 'WEAK_BUY'; color = '#84cc16'; emoji = '🟡'; }
        else if (score <= -8) { signal = 'STRONG_SELL'; color = '#ef4444'; emoji = '🔴🔴'; }
        else if (score <= -4) { signal = 'SELL'; color = '#f87171'; emoji = '🔴'; }
        else { signal = 'NEUTRAL'; color = '#94a3b8'; emoji = '⚪'; }

        // Generate signal if there's enough conviction AND valid levels
        if ((type.length > 0 || Math.abs(score) >= 5) && riskReward >= 0.3) {
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
                targetPrice: +target.toFixed(2),
                stopLoss: +stop.toFixed(2),
                riskReward,
                riskLevel: score > 10 ? 'LOW' : score > 5 ? 'MEDIUM' : 'HIGH',
                marketStatus: marketOpen ? 'MARKET_OPEN' : 'MARKET_CLOSED',
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

    // Helper methods for component scores (keeping old scoring logic)
    getTechnicalScore(stock) {
        let score = 50;
        if (stock.rsi < 30) score += 20;
        else if (stock.rsi < 40) score += 10;
        else if (stock.rsi > 70) score -= 15;
        else if (stock.rsi > 60) score -= 5;
        
        if (stock.s1 && stock.price <= stock.s1 * 1.02) score += 10;
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

    /**
     * Pre-Market Scanner for PSX
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
     * 🔥 Dedicated Pre-Market Analysis
     */
    async analyzePreMarketSession(stocks, orderBookService) {
        const now = new Date();
        const pkTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
        const hours = pkTime.getHours();
        const minutes = pkTime.getMinutes();
        const day = pkTime.getDay();

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

            // Previous day momentum
            if (stock.changePercent > 3) { analysis.score += 4; analysis.reasons.push('🔥 Strong prev close +' + stock.changePercent.toFixed(1) + '%'); }
            else if (stock.changePercent > 1.5) { analysis.score += 2; analysis.reasons.push('✅ Positive prev close'); }
            else if (stock.changePercent < -2) { analysis.score -= 2; analysis.reasons.push('⚠️ Weak prev close'); }

            // Order book analysis
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

            // Technical setup
            if (stock.rsi < 35) { analysis.score += 3; analysis.reasons.push('Oversold - bounce likely'); }
            if (stock.rsi > 40 && stock.rsi < 55 && stock.changePercent > 0) { 
                analysis.score += 2; analysis.reasons.push('RSI momentum building'); 
            }
            if (stock.s1 && stock.price <= stock.s1 * 1.02 && stock.price >= stock.s1) {
                analysis.score += 3; analysis.reasons.push('At support level');
            }

            // Circuit limits
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