'use strict';

/**
 * SMART MONEY TREND FOLLOWING SERVICE
 * Generates actionable trade signals based on institutional mood + price action.
 */

const { getSectorForSymbol } = require('./sectorMappingService');

class SmartMoneyTrendService {
    constructor() {
        this.activePositions = new Map();
        this.signalHistory = [];
        this.maxHistory = 100;
    }

    generateSignals(stocks, moodAnalysis, sectorAnalysis) {
        const signals = [];
        const globalMood = moodAnalysis?.mood || 'NEUTRAL';
        const globalPhase = moodAnalysis?.phase || 'NEUTRAL';
        const globalSignal = moodAnalysis?.signal || 'HOLD';

        const sectorMap = new Map();
        if (sectorAnalysis) {
            sectorAnalysis.forEach(s => sectorMap.set(s.name, s));
        }

        stocks.forEach(stock => {
            const secName = getSectorForSymbol(stock.symbol);
            const sector = sectorMap.get(secName);

            const signal = this._analyzeStock(stock, sector, moodAnalysis, globalMood, globalPhase, globalSignal);
            if (signal) {
                signals.push(signal);
                this._updatePosition(stock.symbol, signal);
            }
        });

        signals.sort((a, b) => b.conviction - a.conviction);

        this.signalHistory.push({
            timestamp: new Date().toISOString(),
            globalMood,
            globalPhase,
            count: signals.length,
            topSignals: signals.slice(0, 5).map(s => ({ symbol: s.symbol, action: s.action }))
        });
        if (this.signalHistory.length > this.maxHistory) this.signalHistory.shift();

        return {
            timestamp: new Date().toISOString(),
            globalContext: {
                mood: globalMood,
                phase: globalPhase,
                signal: globalSignal,
                action: moodAnalysis?.action || 'HOLD'
            },
            signals,
            summary: this._summarizeSignals(signals),
            positionGuidance: this._positionGuidance(signals, moodAnalysis)
        };
    }

    _analyzeStock(stock, sector, moodAnalysis, globalMood, globalPhase, globalSignal) {
        // ─── DECLARE ALL VARIABLES AT TOP ────────────────────────────────
        const symbol = stock.symbol || '';
        const name = stock.name || symbol;
        const price = stock.price || 0;
        const change = stock.changePercent || 0;
        const volume = stock.volume || 0;
        const rsi = stock.rsi || 50;
        const avgVolume = stock.avgVolume || volume;

        const sectorName = getSectorForSymbol(symbol);
        const sectorPhase = sector?.phase || 'NEUTRAL';
        const sectorSignal = sector?.signal || 'HOLD';
        const sectorFipi = sector?.fipiNet || 0;

        const position = this.activePositions.get(symbol);

        // ─── SCORING ─────────────────────────────────────────────────────
        let score = 0;
        const factors = [];

        // 1. Global mood alignment (0-25)
        if (globalMood === 'HEAVY_BUYING') { score += 25; factors.push('Global: Heavy buying mood'); }
        else if (globalMood === 'BUYING') { score += 18; factors.push('Global: Buying mood'); }
        else if (globalMood === 'LIGHT_BUYING') { score += 10; factors.push('Global: Light buying'); }
        else if (globalMood === 'HEAVY_SELLING') { score -= 25; factors.push('Global: Heavy selling'); }
        else if (globalMood === 'SELLING') { score -= 18; factors.push('Global: Selling mood'); }
        else if (globalMood === 'LIGHT_SELLING') { score -= 10; factors.push('Global: Light selling'); }

        // 2. Sector phase alignment (0-20)
        if (sectorPhase === 'ACCUMULATION') { score += 15; factors.push('Sector: Accumulation phase'); }
        else if (sectorPhase === 'MARKUP') { score += 20; factors.push('Sector: Markup phase'); }
        else if (sectorPhase === 'DISTRIBUTION') { score -= 15; factors.push('Sector: Distribution phase'); }
        else if (sectorPhase === 'MARKDOWN') { score -= 20; factors.push('Sector: Markdown phase'); }

        // 3. Sector FIPI flow (0-15)
        if (sectorFipi > 2) { score += 15; factors.push(`Sector FIPI: Strong inflow (+$${sectorFipi.toFixed(2)}M)`); }
        else if (sectorFipi > 0.8) { score += 10; factors.push(`Sector FIPI: Moderate inflow (+$${sectorFipi.toFixed(2)}M)`); }
        else if (sectorFipi > 0.3) { score += 5; factors.push(`Sector FIPI: Light inflow (+$${sectorFipi.toFixed(2)}M)`); }
        else if (sectorFipi < -2) { score -= 15; factors.push(`Sector FIPI: Strong outflow (-$${Math.abs(sectorFipi).toFixed(2)}M)`); }
        else if (sectorFipi < -0.8) { score -= 10; factors.push(`Sector FIPI: Moderate outflow (-$${Math.abs(sectorFipi).toFixed(2)}M)`); }
        else if (sectorFipi < -0.3) { score -= 5; factors.push(`Sector FIPI: Light outflow (-$${Math.abs(sectorFipi).toFixed(2)}M)`); }

        // 4. Price action (0-15)
        if (change > 3) { score += 12; factors.push(`Price: Strong up +${change.toFixed(1)}%`); }
        else if (change > 1.5) { score += 8; factors.push(`Price: Moderate up +${change.toFixed(1)}%`); }
        else if (change > 0.5) { score += 4; factors.push(`Price: Slight up +${change.toFixed(1)}%`); }
        else if (change < -3) { score -= 12; factors.push(`Price: Strong down ${change.toFixed(1)}%`); }
        else if (change < -1.5) { score -= 8; factors.push(`Price: Moderate down ${change.toFixed(1)}%`); }
        else if (change < -0.5) { score -= 4; factors.push(`Price: Slight down ${change.toFixed(1)}%`); }

        // 5. RSI context (0-10)
        if (rsi < 30 && score > 0) { score += 10; factors.push(`RSI: Oversold (${rsi.toFixed(1)}) in bullish context = dip buy`); }
        else if (rsi < 40 && score > 0) { score += 5; factors.push(`RSI: Near oversold (${rsi.toFixed(1)})`); }
        else if (rsi > 70 && score < 0) { score -= 10; factors.push(`RSI: Overbought (${rsi.toFixed(1)}) in bearish context = rally sell`); }
        else if (rsi > 65 && score < 0) { score -= 5; factors.push(`RSI: Near overbought (${rsi.toFixed(1)})`); }
        else if (rsi > 75 && score > 20) { score -= 5; factors.push(`RSI: Extremely overbought (${rsi.toFixed(1)}) — avoid chase`); }

        // 6. Volume confirmation (0-10)
        if (avgVolume > 0 && volume > avgVolume * 2) { 
            score += (score > 0 ? 10 : -10); 
            factors.push(`Volume: ${(volume/avgVolume).toFixed(1)}x average — strong confirmation`); 
        }
        else if (avgVolume > 0 && volume > avgVolume * 1.5) {
            score += (score > 0 ? 5 : -5);
            factors.push(`Volume: ${(volume/avgVolume).toFixed(1)}x average`);
        }

        // 7. Divergence penalty/bonus (0-10)
        const divergences = moodAnalysis?.divergences || [];
        const div = divergences.find(d => d.sector === sectorName);
        if (div) {
            if (div.type === 'BEARISH' && position) {
                score -= 15;
                factors.push(`⚠️ BEARISH DIVERGENCE: ${div.message}`);
            } else if (div.type === 'BULLISH' && !position) {
                score += 15;
                factors.push(`💎 BULLISH DIVERGENCE: ${div.message}`);
            }
        }

        // ─── DETERMINE ACTION ────────────────────────────────────────────
        let action, actionEmoji, urgency, rationale, stopLoss, target;
        const conviction = Math.min(100, Math.max(0, Math.abs(score) + 30));

        if (position) {
            if (score < -20) {
                action = 'EXIT';
                actionEmoji = '🚨';
                urgency = 'IMMEDIATE';
                rationale = `Score dropped to ${score}. Mood flipped against position. Exit to protect capital.`;
                stopLoss = price * 0.98;
            } else if (score < -5) {
                action = 'TRIM';
                actionEmoji = '✂️';
                urgency = 'SOON';
                rationale = `Score weakening (${score}). Take partial profits (${Math.round(conviction/2)}% of position).`;
                stopLoss = position.entryPrice * 0.95;
            } else if (score > 30 && position.size < 3) {
                action = 'ADD';
                actionEmoji = '➕';
                urgency = 'SOON';
                rationale = `Score strong (${score}). Trend confirming. Pyramid into winner (add 30-50% size).`;
                stopLoss = Math.max(position.stopLoss || 0, price * 0.93);
                target = price * 1.08;
            } else {
                action = 'HOLD';
                actionEmoji = '✋';
                urgency = 'PATIENT';
                rationale = `Score ${score}. Position healthy. Let trend work.`;
                stopLoss = Math.max(position.stopLoss || 0, price * 0.92);
            }
        } else {
            if (score >= 40) {
                action = 'STRONG_ENTRY';
                actionEmoji = '🎯';
                urgency = 'IMMEDIATE';
                rationale = `Score ${score}. High-conviction setup: ${factors.slice(0, 3).join('; ')}. Enter with full intended size.`;
                stopLoss = price * 0.94;
                target = price * 1.10;
            } else if (score >= 20) {
                action = 'ENTRY';
                actionEmoji = '▶️';
                urgency = 'SOON';
                rationale = `Score ${score}. Valid setup: ${factors.slice(0, 3).join('; ')}. Enter with 50% size, add on confirmation.`;
                stopLoss = price * 0.93;
                target = price * 1.07;
            } else if (score >= 5) {
                action = 'WATCH';
                actionEmoji = '👀';
                urgency = 'PATIENT';
                rationale = `Score ${score}. Early setup forming. Add to watchlist, wait for score >20 or mood shift.`;
            } else if (score <= -20) {
                action = 'AVOID';
                actionEmoji = '🚫';
                urgency = 'IMMEDIATE';
                rationale = `Score ${score}. Bearish confluence: ${factors.slice(0, 3).join('; ')}. Stay away.`;
            } else {
                action = 'NEUTRAL';
                actionEmoji = '➖';
                urgency = 'PATIENT';
                rationale = `Score ${score}. No edge. Preserve capital.`;
            }
        }

        if (action === 'NEUTRAL' && !position) return null;

        // ─── BUILD RETURN OBJECT ─────────────────────────────────────────
        const result = {
            symbol: symbol,
            name: name,
            sector: sectorName,
            price: parseFloat(price.toFixed(2)),
            change: parseFloat(change.toFixed(2)),
            rsi: parseFloat(rsi.toFixed(1)),
            action: action,
            actionEmoji: actionEmoji,
            urgency: urgency,
            score: score,
            conviction: Math.round(conviction),
            rationale: rationale,
            factors: factors.slice(0, 5),
            stopLoss: stopLoss ? parseFloat(stopLoss.toFixed(2)) : null,
            target: target ? parseFloat(target.toFixed(2)) : null,
            position: position ? { 
                entryPrice: position.entryPrice, 
                size: position.size, 
                pnl: ((price - position.entryPrice) / position.entryPrice * 100).toFixed(1) + '%' 
            } : null,
            moodContext: {
                globalMood: globalMood,
                globalPhase: globalPhase,
                sectorPhase: sectorPhase,
                sectorFipi: sectorFipi
            }
        };

        return result;
    }

    _updatePosition(symbol, signal) {
        const pos = this.activePositions.get(symbol);

        if (signal.action === 'EXIT') {
            this.activePositions.delete(symbol);
        } else if (signal.action === 'TRIM' && pos) {
            pos.size = Math.max(1, pos.size - 1);
        } else if (signal.action === 'ADD' && pos) {
            pos.size += 1;
            pos.stopLoss = signal.stopLoss || pos.stopLoss;
        } else if ((signal.action === 'ENTRY' || signal.action === 'STRONG_ENTRY') && !pos) {
            this.activePositions.set(symbol, {
                entryPrice: signal.price,
                size: signal.action === 'STRONG_ENTRY' ? 2 : 1,
                stopLoss: signal.stopLoss,
                entryDate: new Date().toISOString()
            });
        } else if (pos && signal.stopLoss) {
            pos.stopLoss = Math.max(pos.stopLoss || 0, signal.stopLoss);
        }
    }

    _summarizeSignals(signals) {
        const entries = signals.filter(s => s.action === 'ENTRY' || s.action === 'STRONG_ENTRY');
        const exits = signals.filter(s => s.action === 'EXIT');
        const trims = signals.filter(s => s.action === 'TRIM');
        const holds = signals.filter(s => s.action === 'HOLD' || s.action === 'ADD');
        const avoids = signals.filter(s => s.action === 'AVOID');

        return {
            total: signals.length,
            entries: entries.length,
            strongEntries: entries.filter(s => s.action === 'STRONG_ENTRY').length,
            exits: exits.length,
            trims: trims.length,
            holds: holds.length,
            avoids: avoids.length,
            avgConviction: signals.length > 0 ? Math.round(signals.reduce((s, sig) => s + sig.conviction, 0) / signals.length) : 0,
            topEntry: entries.length > 0 ? entries[0] : null,
            topExit: exits.length > 0 ? exits[0] : null
        };
    }

    _positionGuidance(signals, moodAnalysis) {
        const guidance = [];
        const globalPhase = moodAnalysis?.phase;

        if (globalPhase === 'ACCUMULATION') {
            guidance.push('🎯 **Accumulation Phase Strategy**: Build positions gradually. Use 30-50% of intended size now, add on any dip. Focus on sectors showing bullish divergences.');
        } else if (globalPhase === 'MARKUP') {
            guidance.push('📈 **Markup Phase Strategy**: Hold core positions. Add to winners on pullbacks to 20-EMA. Trail stops below swing lows. Don\'t chase extended moves.');
        } else if (globalPhase === 'DISTRIBUTION') {
            guidance.push('⚠️ **Distribution Phase Strategy**: Take profits on strength. Reduce position sizes by 30-50%. Raise cash. Avoid new entries.');
        } else if (globalPhase === 'MARKDOWN') {
            guidance.push('🔻 **Markdown Phase Strategy**: Preserve capital. Exit non-core positions. Only trade mean-reversion bounces with tight stops. Cash is a position.');
        } else {
            guidance.push('➖ **Neutral Strategy**: No directional edge. Keep 50%+ cash. Only take A+ setups with tight risk management.');
        }

        const activeCount = this.activePositions.size;
        if (activeCount > 10) {
            guidance.push(`⚠️ You have ${activeCount} active positions — consider consolidating to your best 5-7 ideas.`);
        }

        if (moodAnalysis?.moodShift?.shifted) {
            const shift = moodAnalysis.moodShift;
            if (shift.direction === 'BULLISH_SHIFT') {
                guidance.push(`🔄 **Mood Shift Detected**: Institutions just turned bullish from ${shift.from}. This is a high-probability entry window. Increase exposure over next 2-3 sessions.`);
            } else {
                guidance.push(`🔄 **Mood Shift Detected**: Institutions just turned bearish from ${shift.from}. Defensive posture required. Reduce exposure immediately.`);
            }
        }

        return guidance;
    }

    getActivePositions() {
        return Array.from(this.activePositions.entries()).map(([symbol, pos]) => ({
            symbol, ...pos
        }));
    }

    getSignalHistory() {
        return this.signalHistory;
    }
}

module.exports = new SmartMoneyTrendService();