'use strict';

/**
 * INSTITUTIONAL MOOD SERVICE
 * ==========================
 * Detects when big players (FIPI + LIPI) are in BUYING vs SELLING mood.
 * 
 * Mood States (Wyckoff-inspired):
 *   ACCUMULATION  → Smart money buying while price weak (bullish divergence)
 *   MARKUP        → Smart money buying + price rising (trend follow long)
 *   DISTRIBUTION  → Smart money selling while price strong (bearish divergence)
 *   MARKDOWN      → Smart money selling + price falling (trend follow short/exit)
 *   NEUTRAL       → No clear direction
 * 
 * Sub-moods for strength:
 *   HEAVY_BUYING / BUYING / LIGHT_BUYING
 *   HEAVY_SELLING / SELLING / LIGHT_SELLING
 */

const { getSectorForSymbol } = require('./sectorMappingService');

// ─── CONFIG ────────────────────────────────────────────────────────────────

const THRESHOLDS = {
    // FIPI net flow in USD millions
    FIPI_HEAVY_BUY: 2.0,
    FIPI_BUY: 0.8,
    FIPI_SELL: -0.8,
    FIPI_HEAVY_SELL: -2.0,

    // LIPI net flow in USD millions  
    LIPI_HEAVY_BUY: 1.5,
    LIPI_BUY: 0.5,
    LIPI_SELL: -0.5,
    LIPI_HEAVY_SELL: -1.5,

    // Combined (FIPI + LIPI)
    COMBINED_STRONG: 3.0,
    COMBINED_MODERATE: 1.0,

    // Momentum acceleration
    ACCEL_STRONG: 1.5,
    ACCEL_MODERATE: 0.5
};

// ─── MOOD DETECTION ────────────────────────────────────────────────────────

class InstitutionalMoodService {
    constructor() {
        this.moodHistory = []; // Track mood changes over time
        this.maxHistory = 60;
    }

    /**
     * Main entry: Analyze current FIPI/LIPI data + market context
     * Returns complete mood analysis with trend-following guidance
     */
    analyzeMood(fipiData, stockData = [], marketIndex = null) {
        const totals = fipiData?.sectorAnalysis?.totals || { totalFipiNet: 0, totalLocalNet: 0 };
        const momentum = fipiData?.flowMomentum || { fipiTrend: 'FLAT', localTrend: 'FLAT', acceleration: 0 };
        const divergences = fipiData?.divergences || [];
        const history = fipiData?.history || [];

        const fipiNet = totals.totalFipiNet || 0;
        const localNet = totals.totalLocalNet || 0;
        const combinedNet = fipiNet + localNet;

        // 1. Determine base flow mood
        const flowMood = this._classifyFlowMood(fipiNet, localNet, combinedNet);

        // 2. Determine trend phase (Accumulation/Markup/Distribution/Markdown)
        const marketChange = marketIndex?.changePercent || this._estimateMarketChange(stockData);
        const phase = this._detectPhase(flowMood, marketChange, divergences, momentum);

        // 3. Calculate mood strength (0-100)
        const strength = this._calculateMoodStrength(flowMood, momentum, history);

        // 4. Detect mood shift (has sentiment changed recently?)
        const shift = this._detectMoodShift(flowMood, strength);

        // 5. Generate trend-following signal
        const signal = this._generateTrendSignal(flowMood, phase, strength, shift, momentum);

        // 6. Sector mood breakdown
        const sectorMoods = this._analyzeSectorMoods(fipiData?.sectorAnalysis?.sectors || [], stockData);

        const analysis = {
            timestamp: new Date().toISOString(),

            // Core mood
            mood: flowMood.mood,           // HEAVY_BUYING, BUYING, NEUTRAL, SELLING, HEAVY_SELLING
            phase: phase.phase,            // ACCUMULATION, MARKUP, DISTRIBUTION, MARKDOWN, NEUTRAL
            strength: strength.score,      // 0-100
            confidence: strength.confidence, // LOW, MEDIUM, HIGH

            // Raw data
            fipiNet,
            localNet, 
            combinedNet,
            fipiTrend: momentum.fipiTrend,
            localTrend: momentum.localTrend,
            acceleration: momentum.acceleration,

            // Narrative
            narrative: this._buildNarrative(flowMood, phase, strength, momentum, divergences),

            // Trend-following signal
            signal: signal.signal,         // STRONG_BUY, BUY, HOLD, SELL, STRONG_SELL, WAIT
            signalConfidence: signal.confidence,
            action: signal.action,         // Human-readable action
            urgency: signal.urgency,       // IMMEDIATE, SOON, PATIENT

            // Divergences (early warning)
            divergences: divergences.slice(0, 5),

            // Sector breakdown
            sectorMoods,
            topAccumulatingSectors: sectorMoods.filter(s => s.phase === 'ACCUMULATION').slice(0, 3),
            topDistributingSectors: sectorMoods.filter(s => s.phase === 'DISTRIBUTION').slice(0, 3),

            // Historical context
            moodShift: shift,
            previousMood: this.moodHistory.length > 0 ? this.moodHistory[this.moodHistory.length - 1].mood : null,

            // Meta
            dataQuality: fipiData?.cached ? (fipiData?.stale ? 'STALE' : 'CACHED') : 'FRESH'
        };

        // Store in history
        this.moodHistory.push({
            timestamp: analysis.timestamp,
            mood: analysis.mood,
            phase: analysis.phase,
            strength: analysis.strength,
            signal: analysis.signal,
            fipiNet,
            localNet
        });
        if (this.moodHistory.length > this.maxHistory) this.moodHistory.shift();

        return analysis;
    }

    // ─── INTERNAL METHODS ───────────────────────────────────────────────────

    _classifyFlowMood(fipiNet, localNet, combinedNet) {
        let mood, emoji, description;
        let fipiIntensity = 0, localIntensity = 0;

        // FIPI intensity: -2 to +2
        if (fipiNet >= THRESHOLDS.FIPI_HEAVY_BUY) fipiIntensity = 2;
        else if (fipiNet >= THRESHOLDS.FIPI_BUY) fipiIntensity = 1;
        else if (fipiNet <= THRESHOLDS.FIPI_HEAVY_SELL) fipiIntensity = -2;
        else if (fipiNet <= THRESHOLDS.FIPI_SELL) fipiIntensity = -1;

        // LIPI intensity: -2 to +2
        if (localNet >= THRESHOLDS.LIPI_HEAVY_BUY) localIntensity = 2;
        else if (localNet >= THRESHOLDS.LIPI_BUY) localIntensity = 1;
        else if (localNet <= THRESHOLDS.LIPI_HEAVY_SELL) localIntensity = -2;
        else if (localNet <= THRESHOLDS.LIPI_SELL) localIntensity = -1;

        // Combined classification
        const totalIntensity = fipiIntensity + (localIntensity * 0.5); // FIPI weighted 2x

        if (totalIntensity >= 3) {
            mood = 'HEAVY_BUYING';
            emoji = '🚀🚀';
            description = 'Foreigners aggressively buying, locals confirming. Strong institutional demand.';
        } else if (totalIntensity >= 1.5) {
            mood = 'BUYING';
            emoji = '🚀';
            description = 'Net institutional inflows. Smart money accumulating positions.';
        } else if (totalIntensity > 0) {
            mood = 'LIGHT_BUYING';
            emoji = '👍';
            description = 'Slight institutional preference for buying. Early accumulation signs.';
        } else if (totalIntensity <= -3) {
            mood = 'HEAVY_SELLING';
            emoji = '🔻🔻';
            description = 'Foreigners dumping, locals selling too. Institutional exodus.';
        } else if (totalIntensity <= -1.5) {
            mood = 'SELLING';
            emoji = '🔻';
            description = 'Net institutional outflows. Smart money reducing exposure.';
        } else if (totalIntensity < 0) {
            mood = 'LIGHT_SELLING';
            emoji = '⚠️';
            description = 'Slight institutional selling. Caution warranted.';
        } else {
            mood = 'NEUTRAL';
            emoji = '➖';
            description = 'Institutional flows balanced. No clear directional bias.';
        }

        // Alignment check
        const aligned = (fipiIntensity > 0 && localIntensity >= 0) || 
                       (fipiIntensity < 0 && localIntensity <= 0) ||
                       (fipiIntensity === 0 && localIntensity === 0);

        return { mood, emoji, description, fipiIntensity, localIntensity, totalIntensity, aligned };
    }

    _detectPhase(flowMood, marketChange, divergences, momentum) {
        const { mood, fipiIntensity } = flowMood;
        const isBuying = fipiIntensity > 0;
        const isSelling = fipiIntensity < 0;
        const marketUp = marketChange > 0.5;
        const marketDown = marketChange < -0.5;

        let phase, emoji, description;

        // Check divergences first (they override)
        const hasAccumulationDiv = divergences.some(d => d.signal === 'ACCUMULATION');
        const hasDistributionDiv = divergences.some(d => d.signal === 'DISTRIBUTION');

        if ((isBuying && marketDown) || hasAccumulationDiv) {
            phase = 'ACCUMULATION';
            emoji = '💎';
            description = 'Smart money buying into weakness. Classic accumulation. Watch for breakout.';
        } else if (isBuying && marketUp) {
            phase = 'MARKUP';
            emoji = '📈';
            description = 'Institutions buying + price rising. Trend-following long opportunity.';
        } else if ((isSelling && marketUp) || hasDistributionDiv) {
            phase = 'DISTRIBUTION';
            emoji = '⚠️';
            description = 'Smart money selling into strength. Distribution phase. Consider taking profits.';
        } else if (isSelling && marketDown) {
            phase = 'MARKDOWN';
            emoji = '📉';
            description = 'Institutions selling + price falling. Trend-following exit or short.';
        } else {
            phase = 'NEUTRAL';
            emoji = '➖';
            description = 'No clear Wyckoff phase. Wait for confirmation.';
        }

        return { phase, emoji, description, marketChange };
    }

    _calculateMoodStrength(flowMood, momentum, history) {
        let score = 30; // Base score
        let confidence = 'MEDIUM';

        // Flow magnitude contribution (0-40 points)
        const absFlow = Math.abs(flowMood.totalIntensity);
        score += Math.min(40, absFlow * 15);

        // Trend alignment bonus (0-15 points)
        if (flowMood.aligned) score += 15;

        // Momentum bonus (0-15 points)
        if (momentum.fipiTrend === 'RISING' && flowMood.fipiIntensity > 0) score += 10;
        if (momentum.fipiTrend === 'FALLING' && flowMood.fipiIntensity < 0) score += 10;
        if (Math.abs(momentum.acceleration) > THRESHOLDS.ACCEL_STRONG) score += 5;

        // Historical consistency (0-10 points)
        if (history.length >= 3) {
            const recent = history.slice(-3);
            const consistent = recent.every(h => 
                (flowMood.fipiIntensity > 0 && h.fipiNet > 0) ||
                (flowMood.fipiIntensity < 0 && h.fipiNet < 0) ||
                flowMood.fipiIntensity === 0
            );
            if (consistent) score += 10;
        }

        // Confidence based on data quality
        if (history.length >= 5 && flowMood.aligned) confidence = 'HIGH';
        else if (history.length < 2 || !flowMood.aligned) confidence = 'LOW';

        // Cap at 100
        score = Math.min(100, Math.max(0, score));

        return { score: Math.round(score), confidence };
    }

    _detectMoodShift(currentFlowMood, strength) {
        if (this.moodHistory.length < 2) return { shifted: false, direction: 'NONE', recency: 'N/A' };

        const previous = this.moodHistory[this.moodHistory.length - 1];
        const currentMood = currentFlowMood.mood;
        const prevMood = previous.mood;

        if (currentMood === prevMood) {
            return { shifted: false, direction: 'NONE', from: prevMood, to: currentMood };
        }

        // Determine shift direction
        const moodOrder = ['HEAVY_SELLING', 'SELLING', 'LIGHT_SELLING', 'NEUTRAL', 'LIGHT_BUYING', 'BUYING', 'HEAVY_BUYING'];
        const currIdx = moodOrder.indexOf(currentMood);
        const prevIdx = moodOrder.indexOf(prevMood);
        const direction = currIdx > prevIdx ? 'BULLISH_SHIFT' : 'BEARISH_SHIFT';

        // Calculate how recent (in data points)
        const recency = this.moodHistory.length;

        return {
            shifted: true,
            direction,
            from: prevMood,
            to: currentMood,
            strength: strength.score,
            recency: `${recency} readings ago`
        };
    }

    _generateTrendSignal(flowMood, phase, strength, shift, momentum) {
        const { mood, fipiIntensity } = flowMood;
        const { phase: phaseName } = phase;
        const { score } = strength;
        const { shifted, direction } = shift;

        let signal, action, urgency, confidence;

        // ─── ACCUMULATION PHASE ─────────────────────────────────────────────
        if (phaseName === 'ACCUMULATION') {
            if (shifted && direction === 'BULLISH_SHIFT') {
                signal = 'STRONG_BUY';
                action = '🎯 START ACCUMULATING: Institutions just shifted to buying mode while prices are down. This is the ideal entry zone. Scale in gradually.';
                urgency = 'IMMEDIATE';
                confidence = 'HIGH';
            } else if (score > 60) {
                signal = 'BUY';
                action = '📥 ACCUMULATE ON DIPS: Smart money is buying weakness. Add to positions on pullbacks. Set stop-loss below recent swing low.';
                urgency = 'SOON';
                confidence = 'MEDIUM';
            } else {
                signal = 'WAIT';
                action = '👀 WATCHLIST: Accumulation detected but wait for volume confirmation or price breakout before entering.';
                urgency = 'PATIENT';
                confidence = 'LOW';
            }
        }
        // ─── MARKUP PHASE ───────────────────────────────────────────────────
        else if (phaseName === 'MARKUP') {
            if (momentum.acceleration > 1.0) {
                signal = 'STRONG_BUY';
                action = '🚀 RIDE THE WAVE: Institutional buying is ACCELERATING with rising prices. Add to winners. Trail your stops.';
                urgency = 'IMMEDIATE';
                confidence = 'HIGH';
            } else if (score > 50) {
                signal = 'BUY';
                action = '📈 TREND FOLLOW: Markup phase confirmed. Hold existing positions, add on shallow pullbacks. Don\'t fight the tape.';
                urgency = 'SOON';
                confidence = 'MEDIUM';
            } else {
                signal = 'HOLD';
                action = '✋ HOLD: Markup phase but momentum slowing. Hold positions but avoid new entries at these levels.';
                urgency = 'PATIENT';
                confidence = 'MEDIUM';
            }
        }
        // ─── DISTRIBUTION PHASE ─────────────────────────────────────────────
        else if (phaseName === 'DISTRIBUTION') {
            if (shifted && direction === 'BEARISH_SHIFT') {
                signal = 'STRONG_SELL';
                action = '🚨 TAKE PROFITS NOW: Institutions just flipped to selling while prices are still up. Exit longs immediately. Consider hedging.';
                urgency = 'IMMEDIATE';
                confidence = 'HIGH';
            } else if (score > 60) {
                signal = 'SELL';
                action = '💰 REDUCE EXPOSURE: Distribution confirmed. Trim winners, raise cash. Smart money is selling to retail.';
                urgency = 'SOON';
                confidence = 'MEDIUM';
            } else {
                signal = 'HOLD';
                action = '⚠️ CAUTION: Early distribution signs. Tighten stops, take partial profits. Don\'t add new money.';
                urgency = 'PATIENT';
                confidence = 'LOW';
            }
        }
        // ─── MARKDOWN PHASE ─────────────────────────────────────────────────
        else if (phaseName === 'MARKDOWN') {
            if (momentum.acceleration < -1.0) {
                signal = 'STRONG_SELL';
                action = '🔻 EXIT ALL: Institutional selling is accelerating with falling prices. Cash is king. Protect capital.';
                urgency = 'IMMEDIATE';
                confidence = 'HIGH';
            } else {
                signal = 'SELL';
                action = '📉 STAY DEFENSIVE: Markdown phase active. Avoid new longs. Consider shorting strength or staying in cash.';
                urgency = 'SOON';
                confidence = 'MEDIUM';
            }
        }
        // ─── NEUTRAL ────────────────────────────────────────────────────────
        else {
            if (shifted && direction === 'BULLISH_SHIFT') {
                signal = 'BUY';
                action = '⬆️ EARLY ENTRY: Mood just turned bullish from neutral. Start small positions, scale up on confirmation.';
                urgency = 'SOON';
                confidence = 'MEDIUM';
            } else if (shifted && direction === 'BEARISH_SHIFT') {
                signal = 'SELL';
                action = '⬇️ DEFENSIVE: Mood turned bearish from neutral. Reduce risk, raise cash. Wait for clarity.';
                urgency = 'SOON';
                confidence = 'MEDIUM';
            } else {
                signal = 'HOLD';
                action = '➖ STAY PATIENT: No clear institutional direction. Preserve capital until a trend emerges.';
                urgency = 'PATIENT';
                confidence = 'LOW';
            }
        }

        return { signal, action, urgency, confidence };
    }

    _analyzeSectorMoods(sectors, stockData) {
        const stockMap = new Map();
        stockData.forEach(s => stockMap.set(s.symbol, s));

        return sectors.map(sector => {
            const stocks = sector.stocks || [];
            const avgChange = stocks.length > 0 
                ? stocks.reduce((sum, s) => sum + (s.changePercent || 0), 0) / stocks.length 
                : 0;

            const fipiNet = sector.fipiNet || 0;
            const localNet = sector.localNet || 0;

            // Classify sector phase
            let phase, phaseEmoji;
            if (fipiNet > 0.3 && avgChange < -0.5) {
                phase = 'ACCUMULATION'; phaseEmoji = '💎';
            } else if (fipiNet > 0.3 && avgChange > 0.5) {
                phase = 'MARKUP'; phaseEmoji = '📈';
            } else if (fipiNet < -0.3 && avgChange > 0.5) {
                phase = 'DISTRIBUTION'; phaseEmoji = '⚠️';
            } else if (fipiNet < -0.3 && avgChange < -0.5) {
                phase = 'MARKDOWN'; phaseEmoji = '📉';
            } else {
                phase = 'NEUTRAL'; phaseEmoji = '➖';
            }

            // Sector signal
            let signal;
            if (phase === 'ACCUMULATION') signal = 'WATCH_BUY';
            else if (phase === 'MARKUP') signal = 'BUY';
            else if (phase === 'DISTRIBUTION') signal = 'REDUCE';
            else if (phase === 'MARKDOWN') signal = 'AVOID';
            else signal = 'HOLD';

            return {
                name: sector.name,
                fipiNet: parseFloat(fipiNet.toFixed(2)),
                localNet: parseFloat(localNet.toFixed(2)),
                netValueUSD: parseFloat((sector.netValueUSD || 0).toFixed(2)),
                avgChange: parseFloat(avgChange.toFixed(2)),
                stockCount: sector.stockCount || stocks.length,
                phase,
                phaseEmoji,
                signal,
                // For sorting
                compositeFlow: parseFloat((fipiNet * 2 + localNet).toFixed(2))
            };
        }).sort((a, b) => b.compositeFlow - a.compositeFlow);
    }

    _buildNarrative(flowMood, phase, strength, momentum, divergences) {
        const parts = [];

        parts.push(`${flowMood.emoji} **Institutional Mood: ${flowMood.mood.replace(/_/g, ' ')}** (${strength.score}/100 strength)`);
        parts.push(`${phase.emoji} **Market Phase: ${phase.phase}** — ${phase.description}`);

        if (flowMood.aligned) {
            parts.push(`✅ Foreign and local institutions are **aligned** — this is a high-conviction signal.`);
        } else {
            parts.push(`⚠️ Foreign and local institutions are **divergent** — caution, mixed signals.`);
        }

        if (momentum.acceleration > THRESHOLDS.ACCEL_STRONG) {
            parts.push(`🚀 Flows are **accelerating bullish** — momentum building.`);
        } else if (momentum.acceleration < -THRESHOLDS.ACCEL_STRONG) {
            parts.push(`🔻 Flows are **accelerating bearish** — selling pressure intensifying.`);
        }

        if (divergences.length > 0) {
            const topDiv = divergences[0];
            parts.push(`🔍 **Divergence Alert:** ${topDiv.message}`);
        }

        return parts.join('\n\n');
    }

    _estimateMarketChange(stockData) {
        if (!stockData || stockData.length === 0) return 0;
        const totalCap = stockData.reduce((sum, s) => sum + ((s.price || 0) * (s.volume || 0)), 0);
        if (totalCap === 0) return 0;
        const weightedChange = stockData.reduce((sum, s) => {
            const weight = ((s.price || 0) * (s.volume || 0)) / totalCap;
            return sum + ((s.changePercent || 0) * weight);
        }, 0);
        return weightedChange;
    }

    // ─── UTILITIES ──────────────────────────────────────────────────────────

    getMoodHistory() {
        return this.moodHistory;
    }

    getLastMoodShift() {
        for (let i = this.moodHistory.length - 1; i > 0; i--) {
            if (this.moodHistory[i].mood !== this.moodHistory[i-1].mood) {
                return {
                    from: this.moodHistory[i-1].mood,
                    to: this.moodHistory[i].mood,
                    timestamp: this.moodHistory[i].timestamp,
                    fipiNet: this.moodHistory[i].fipiNet
                };
            }
        }
        return null;
    }

    isBullish() {
        if (this.moodHistory.length === 0) return false;
        const last = this.moodHistory[this.moodHistory.length - 1];
        return ['HEAVY_BUYING', 'BUYING', 'LIGHT_BUYING'].includes(last.mood);
    }

    isAccumulationPhase() {
        if (this.moodHistory.length === 0) return false;
        return this.moodHistory[this.moodHistory.length - 1].phase === 'ACCUMULATION';
    }
}

module.exports = new InstitutionalMoodService();
