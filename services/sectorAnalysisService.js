'use strict';

const { getSectorForSymbol, getStocksForSector, getAllSectors } = require('./sectorMappingService');
const moodService = require('./institutionalMoodService');
const trendService = require('./smartMoneyTrendService');
const rotationService = require('./sectorRotationService');

/**
 * ENHANCED SECTOR ANALYSIS SERVICE
 * ================================
 * Wires together FIPI/LIPI data, institutional mood, trend following,
 * and sector rotation into a unified analysis output.
 * 
 * This is your MAIN orchestrator — call this and get everything.
 */

class SectorAnalysisService {
    constructor() {
        this.cache = null;
        this.lastUpdate = 0;
        this.ttl = 60000;
    }

    /**
     * MAIN METHOD: Full analysis pipeline
     * 
     * @param {Array} stocks - Array of stock objects with symbol, price, changePercent, volume, rsi
     * @param {Object} fipiData - Output from fipiLipService.getFipiLipData()
     * @param {Array} orderFlowTopStocks - Top order flow stocks
     * @param {Object} instSignals - Institutional signals
     * @param {Array} tradeSignals - Trading signals
     * @param {Object} newsSignal - News sentiment
     * @param {Object} announcements - Corporate announcements
     * @param {Object} marketIndex - { changePercent } for KSE-100 or overall market
     * @returns {Object} Complete analysis with mood, sectors, signals, rotation
     */
    analyze(stocks, fipiData, orderFlowTopStocks, instSignals, tradeSignals, newsSignal, announcements, marketIndex = null) {
        const now = Date.now();
        if (this.cache && (now - this.lastUpdate) < this.ttl) {
            return this.cache;
        }

        // ─── STEP 1: Build base sector profiles ──────────────────────────────
        const sectors = this._buildProfiles(stocks, fipiData, orderFlowTopStocks, instSignals, tradeSignals, newsSignal, announcements);

        // ─── STEP 2: Detect institutional mood ───────────────────────────────
        const moodAnalysis = moodService.analyzeMood(fipiData, stocks, marketIndex);

        // ─── STEP 3: Detect sector rotation ──────────────────────────────────
        const rotationAnalysis = rotationService.detectRotation(
            sectors.filter(s => s.stockCount > 0),
            fipiData?.history || []
        );

        // ─── STEP 4: Generate trend-following signals ────────────────────────
        const signalAnalysis = trendService.generateSignals(stocks, moodAnalysis, sectors);

        // ─── STEP 5: Enhance sectors with mood/rotation context ──────────────
        const enhancedSectors = sectors.map(sector => {
            const sectorMood = moodAnalysis.sectorMoods?.find(m => m.name === sector.name);
            const sectorRotation = rotationAnalysis.allSectors?.find(r => r.name === sector.name);
            const sectorSignals = signalAnalysis.signals?.filter(s => s.sector === sector.name) || [];

            return {
                ...sector,

                // Mood context
                mood: sectorMood?.phase || 'NEUTRAL',
                moodEmoji: sectorMood?.phaseEmoji || '➖',
                sectorSignal: sectorMood?.signal || 'HOLD',

                // Rotation context
                flowChange: sectorRotation?.flowChange || 0,
                sectorRank: sectorRotation?.rank || 0,
                rotationSignal: sectorRotation ? (sectorRotation.flowChange > 0.5 ? 'ROTATE_IN' : sectorRotation.flowChange < -0.5 ? 'ROTATE_OUT' : 'HOLD') : 'HOLD',

                // Signals for this sector
                stockSignals: sectorSignals,
                bestSetup: sectorSignals.length > 0 ? sectorSignals[0] : null,

                // Enhanced narrative
                moodNarrative: this._buildSectorMoodNarrative(sector, sectorMood, sectorRotation)
            };
        });

        // ─── STEP 6: Build unified output ────────────────────────────────────
        const result = {
            timestamp: new Date().toISOString(),
            date: fipiData?.date || new Date().toISOString().split('T')[0],

            // ── INSTITUTIONAL MOOD (what user asked for) ─────────────────────
            institutionalMood: {
                current: moodAnalysis.mood,
                phase: moodAnalysis.phase,
                strength: moodAnalysis.strength,
                confidence: moodAnalysis.confidence,
                emoji: this._moodEmoji(moodAnalysis.mood),
                narrative: moodAnalysis.narrative,
                signal: moodAnalysis.signal,
                action: moodAnalysis.action,
                urgency: moodAnalysis.urgency,

                // Key numbers
                fipiNet: moodAnalysis.fipiNet,
                localNet: moodAnalysis.localNet,
                combinedNet: moodAnalysis.combinedNet,
                acceleration: moodAnalysis.acceleration,

                // Shifts (CRITICAL for trend following)
                moodShift: moodAnalysis.moodShift,
                previousMood: moodAnalysis.previousMood,

                // Divergences (early warning)
                divergences: moodAnalysis.divergences,

                // History
                moodHistory: moodService.getMoodHistory()
            },

            // ── SECTOR ROTATION ──────────────────────────────────────────────
            sectorRotation: {
                rotating: rotationAnalysis.rotating,
                style: rotationAnalysis.rotationStyle,
                narrative: rotationAnalysis.narrative,
                hotSectors: rotationAnalysis.hotSectors,
                coldSectors: rotationAnalysis.coldSectors,
                improving: rotationAnalysis.improvingSectors,
                deteriorating: rotationAnalysis.deterioratingSectors,
                tradeIdeas: rotationAnalysis.tradeIdeas,
                history: rotationService.getRotationHistory()
            },

            // ── SECTOR PROFILES ──────────────────────────────────────────────
            sectors: enhancedSectors,

            topSectors: enhancedSectors
                .filter(s => s.stockCount > 0)
                .slice(0, 10),

            strongestAccumulation: enhancedSectors
                .filter(s => s.mood === 'ACCUMULATION')
                .sort((a, b) => b.fipiNet - a.fipiNet)
                .slice(0, 3),

            strongestMarkup: enhancedSectors
                .filter(s => s.mood === 'MARKUP')
                .sort((a, b) => b.fipiNet - a.fipiNet)
                .slice(0, 3),

            distributionWarning: enhancedSectors
                .filter(s => s.mood === 'DISTRIBUTION')
                .sort((a, b) => a.fipiNet - b.fipiNet)
                .slice(0, 3),

            // ── TREND-FOLLOWING SIGNALS ──────────────────────────────────────
            signals: {
                globalContext: signalAnalysis.globalContext,
                allSignals: signalAnalysis.signals,
                summary: signalAnalysis.summary,
                positionGuidance: signalAnalysis.positionGuidance,
                activePositions: trendService.getActivePositions(),
                history: trendService.getSignalHistory()
            },

            // ── EXECUTIVE SUMMARY ────────────────────────────────────────────
            executiveSummary: this._buildExecutiveSummary(moodAnalysis, rotationAnalysis, signalAnalysis, enhancedSectors)
        };

        this.cache = result;
        this.lastUpdate = now;
        return result;
    }

    // ─── BASE PROFILE BUILDING (from original, enhanced) ────────────────────

    _buildProfiles(stocks, fipiData, orderFlowTop, instSignals, tradeSignals, newsSignal, announcements) {
        const sectors = new Map();
        const knownNames = getAllSectors();
        knownNames.forEach(n => sectors.set(n, this._emptySector(n)));

        // 1. Aggregate stock data by sector
        stocks.forEach(st => {
            const secName = getSectorForSymbol(st.symbol);
            if (!sectors.has(secName)) sectors.set(secName, this._emptySector(secName));
            const s = sectors.get(secName);
            s.stocks.push(st);
            s.stockCount++;
            s.totalVolume += (st.volume || 0);
            s.avgChange += (st.changePercent || 0);
            if (st.changePercent > 0) s.gainers++;
            if (st.changePercent < 0) s.losers++;
            s.avgRSI += (st.rsi || 50);
        });

        sectors.forEach(s => {
            if (s.stockCount > 0) {
                s.avgChange = s.avgChange / s.stockCount;
                s.avgRSI = s.avgRSI / s.stockCount;
            }
        });

        // 2. Merge FIPI/LIPI sector data
        if (fipiData?.sectorAnalysis?.sectors) {
            fipiData.sectorAnalysis.sectors.forEach(fs => {
                const name = (fs.name || '').replace(' (mn$)', '').trim();
                const sec = this._findSector(sectors, name);
                if (sec) {
                    sec.fipiNet = fs.fipiNet || 0;
                    sec.localNet = fs.localNet || 0;
                    sec.netValueUSD = fs.netValueUSD || 0;
                    sec.sectorBuyVol = fs.totalBuyVol || 0;
                    sec.sectorSellVol = fs.totalSellVol || 0;
                }
            });
        }

        // 3. Merge order flow
        if (orderFlowTop) {
            orderFlowTop.forEach(o => {
                const secName = getSectorForSymbol(o.symbol);
                if (sectors.has(secName)) {
                    const s = sectors.get(secName);
                    s.orderFlowNet += (o.netFlow || 0);
                }
            });
        }

        // 4. Merge institutional signals
        if (instSignals?.signals) {
            instSignals.signals.forEach(sig => {
                const secName = getSectorForSymbol(sig.symbol);
                if (sectors.has(secName)) {
                    const s = sectors.get(secName);
                    s.institutionalScore += (sig.score || 0);
                    if (sig.signal?.includes('BUY')) s.instBuys++;
                    if (sig.signal?.includes('SELL')) s.instSells++;
                }
            });
        }

        // 5. Merge trading signals
        if (tradeSignals) {
            tradeSignals.forEach(ts => {
                const secName = getSectorForSymbol(ts.symbol);
                if (sectors.has(secName)) {
                    const s = sectors.get(secName);
                    if (ts.signal === 'STRONG_BUY') s.signalCounts.strongBuy++;
                    else if (ts.signal === 'BUY') s.signalCounts.buy++;
                    else if (ts.signal === 'SELL') s.signalCounts.sell++;
                    else if (ts.signal === 'STRONG_SELL') s.signalCounts.strongSell++;
                    else s.signalCounts.neutral++;
                }
            });
        }

        // 6. Merge announcements
        if (announcements?.announcements) {
            announcements.announcements.forEach(ann => {
                const secName = getSectorForSymbol(ann.symbol);
                if (sectors.has(secName)) {
                    const s = sectors.get(secName);
                    s.announcements.push(ann);
                    if (ann.impact === 'STRONG_POSITIVE' || ann.impact === 'POSITIVE') s.catalystScore += 2;
                    else if (ann.impact === 'STRONG_NEGATIVE' || ann.impact === 'NEGATIVE') s.catalystScore -= 2;
                    if (ann.type === 'DIV' || ann.type === 'BON') s.catalystScore += 1;
                }
            });
        }

        // 7. Calculate & narrate
        const result = [];
        sectors.forEach(s => {
            if (s.stockCount === 0) return;
            this._score(s);
            this._recommend(s);
            this._narrate(s);
            result.push(s);
        });

        return result
            .filter(s => s.name !== 'All other Sectors')
            .sort((a, b) => b.compositeScore - a.compositeScore);
    }

    _emptySector(name) {
        return {
            name, stocks: [], stockCount: 0, totalVolume: 0,
            avgChange: 0, avgRSI: 0, gainers: 0, losers: 0,
            fipiNet: 0, localNet: 0, netValueUSD: 0,
            sectorBuyVol: 0, sectorSellVol: 0,
            orderFlowNet: 0, institutionalScore: 0,
            instBuys: 0, instSells: 0,
            signalCounts: { strongBuy:0, buy:0, neutral:0, sell:0, strongSell:0 },
            announcements: [], catalystScore: 0,
            compositeScore: 0, trend: 'NEUTRAL', moneyFlow: 'NEUTRAL',
            smartMoney: 'NEUTRAL', riskLevel: 'MEDIUM',
            recommendation: 'HOLD', recColor: '#94a3b8', recEmoji: '➖',
            narrative: '', keyCatalysts: [], topStocks: []
        };
    }

    _findSector(map, name) {
        if (map.has(name)) return map.get(name);
        for (const [k, v] of map) {
            if (name.includes(k) || k.includes(name)) return v;
        }
        return null;
    }

    _score(s) {
        let mom = 0;
        if (s.avgChange > 2) mom = 5;
        else if (s.avgChange > 1) mom = 3;
        else if (s.avgChange > 0.5) mom = 1;
        else if (s.avgChange < -2) mom = -5;
        else if (s.avgChange < -1) mom = -3;
        else if (s.avgChange < -0.5) mom = -1;

        const breadth = s.stockCount ? (s.gainers - s.losers) / s.stockCount : 0;
        mom += Math.round(breadth * 3);
        mom = Math.max(-5, Math.min(5, mom));

        let flow = 0;
        if (s.fipiNet > 1.5) flow += 4;
        else if (s.fipiNet > 0.5) flow += 2;
        else if (s.fipiNet < -1.5) flow -= 4;
        else if (s.fipiNet < -0.5) flow -= 2;
        if (s.localNet > 1.5) flow += 2;
        else if (s.localNet > 0.5) flow += 1;
        else if (s.localNet < -1.5) flow -= 2;
        else if (s.localNet < -0.5) flow -= 1;
        flow = Math.max(-5, Math.min(5, flow));

        let smart = 0;
        const instBias = s.instBuys - s.instSells;
        if (instBias >= 3) smart = 5;
        else if (instBias >= 1) smart = 3;
        else if (instBias <= -3) smart = -5;
        else if (instBias <= -1) smart = -3;
        if (s.orderFlowNet > 100000) smart += 2;
        else if (s.orderFlowNet < -100000) smart -= 2;
        smart = Math.max(-5, Math.min(5, smart));

        const cat = Math.max(-5, Math.min(5, s.catalystScore));

        let tech = 0;
        if (s.avgRSI > 70) tech = -3;
        else if (s.avgRSI > 60) tech = -1;
        else if (s.avgRSI < 30) tech = 4;
        else if (s.avgRSI < 40) tech = 2;

        s.momentumScore = mom;
        s.flowScore = flow;
        s.smartMoneyScore = smart;
        s.catalystScoreVal = cat;
        s.technicalScore = tech;
        s.compositeScore = mom + flow + smart + cat + tech;

        s.trend = mom >= 3 ? 'BULLISH' : mom <= -3 ? 'BEARISH' : 'NEUTRAL';
        s.moneyFlow = flow >= 2 ? 'INFLOW' : flow <= -2 ? 'OUTFLOW' : 'MIXED';
        s.smartMoney = smart >= 2 ? 'ACCUMULATING' : smart <= -2 ? 'DISTRIBUTING' : 'NEUTRAL';

        const vola = Math.abs(s.avgChange);
        if (vola > 3 || s.stockCount < 3) s.riskLevel = 'HIGH';
        else if (vola > 1.5) s.riskLevel = 'MEDIUM';
        else s.riskLevel = 'LOW';
    }

    _recommend(s) {
        const sc = s.compositeScore;
        const map = [
            { min: 15,  rec:'STRONG_BUY', color:'#22c55e', emoji:'🚀' },
            { min: 8,   rec:'BUY',        color:'#4ade80', emoji:'🟢' },
            { min: 3,   rec:'ACCUMULATE', color:'#3b82f6', emoji:'⬆️' },
            { min: -2,  rec:'HOLD',       color:'#f59e0b', emoji:'➖' },
            { min: -7,  rec:'REDUCE',     color:'#f87171', emoji:'⬇️' },
            { min: -14, rec:'AVOID',      color:'#ef4444', emoji:'🔴' },
            { min: -99, rec:'STRONG_AVOID',color:'#7f1d1d', emoji:'⛔' }
        ];
        const r = map.find(m => sc >= m.min);
        s.recommendation = r.rec;
        s.recColor = r.color;
        s.recEmoji = r.emoji;
    }

    _narrate(s) {
        const parts = [];
        if (s.trend === 'BULLISH') {
            parts.push(`${s.name} is showing bullish momentum with ${s.gainers}/${s.stockCount} stocks advancing (avg +${s.avgChange.toFixed(2)}%).`);
        } else if (s.trend === 'BEARISH') {
            parts.push(`${s.name} is under pressure with ${s.losers}/${s.stockCount} stocks declining (avg ${s.avgChange.toFixed(2)}%).`);
        } else {
            parts.push(`${s.name} is moving sideways with mixed price action across ${s.stockCount} constituents.`);
        }

        if (s.moneyFlow === 'INFLOW') {
            const fipiTxt = s.fipiNet > 0 ? `Foreign investors are net buyers (+$${s.fipiNet.toFixed(2)}M)` : 'Foreign flows are muted';
            const locTxt  = s.localNet > 0 ? `while locals are accumulating (+$${s.localNet.toFixed(2)}M)` : 'with local participation mixed';
            parts.push(`${fipiTxt}, ${locTxt}.`);
        } else if (s.moneyFlow === 'OUTFLOW') {
            parts.push(`Money is exiting the sector with combined net outflows of $${Math.abs(s.fipiNet + s.localNet).toFixed(2)}M.`);
        }

        if (s.smartMoney === 'ACCUMULATING') {
            parts.push(`Smart money is positive — ${s.instBuys} institutional buy setups detected.`);
        } else if (s.smartMoney === 'DISTRIBUTING') {
            parts.push(`Caution: ${s.instSells} institutional distribution signals suggest large players are reducing exposure.`);
        }

        if (s.avgRSI < 35) {
            parts.push(`Sector RSI at ${s.avgRSI.toFixed(1)} suggests oversold conditions — potential mean-reversion opportunity.`);
        } else if (s.avgRSI > 65) {
            parts.push(`Sector RSI at ${s.avgRSI.toFixed(1)} indicates overbought conditions — consider waiting for a pullback.`);
        }

        const topAnn = s.announcements.slice(0, 2);
        if (topAnn.length) {
            const txt = topAnn.map(a => `${a.typeIcon || '📢'} ${a.typeLabel || 'News'} for ${a.symbol}`).join(', ');
            parts.push(`Recent catalysts: ${txt}.`);
        }

        const buySigs = s.signalCounts.strongBuy + s.signalCounts.buy;
        const sellSigs = s.signalCounts.strongSell + s.signalCounts.sell;
        if (buySigs + sellSigs > 0) {
            parts.push(`Algo signals: ${buySigs} buy vs ${sellSigs} sell across the sector.`);
        }

        const verdicts = {
            'STRONG_BUY':'Multiple bullish confluences suggest aggressive accumulation.',
            'BUY':'Positive momentum and flows support gradual position building.',
            'ACCUMULATE':'Early signs of strength — start scaling in on dips.',
            'HOLD':'Wait for clearer directional confirmation before adding.',
            'REDUCE':'Weakness emerging — consider trimming positions.',
            'AVOID':'Several bearish signals suggest staying on the sidelines.',
            'STRONG_AVOID':'Strong distribution and negative catalysts — exit exposure.'
        };
        parts.push(`\n→ ${s.recEmoji} Verdict: **${s.recommendation.replace(/_/g,' ')}** — ${verdicts[s.recommendation]}`);

        s.narrative = parts.join(' ');
        s.keyCatalysts = topAnn.map(a => ({ symbol: a.symbol, type: a.type, title: a.title }));
        s.topStocks = s.stocks
            .sort((a,b) => (b.changePercent||0) - (a.changePercent||0))
            .slice(0,5)
            .map(st => ({ symbol: st.symbol, price: st.price, change: st.changePercent, signal: st.signal, rsi: st.rsi }));
    }

    // ─── ENHANCED HELPERS ───────────────────────────────────────────────────

    _buildSectorMoodNarrative(sector, sectorMood, sectorRotation) {
        if (!sectorMood) return sector.narrative;

        const parts = [sector.narrative];

        if (sectorMood.phase === 'ACCUMULATION') {
            parts.push(`\n💎 **Smart Money Signal:** ${sector.name} is in ACCUMULATION phase — FIPI buying into weakness. Potential bottom forming.`);
        } else if (sectorMood.phase === 'MARKUP') {
            parts.push(`\n📈 **Trend Following:** ${sector.name} in MARKUP — ride the wave. Trail stops below support.`);
        } else if (sectorMood.phase === 'DISTRIBUTION') {
            parts.push(`\n⚠️ **Warning:** ${sector.name} showing DISTRIBUTION — smart money selling to retail. Take profits.`);
        } else if (sectorMood.phase === 'MARKDOWN') {
            parts.push(`\n🔻 **Avoid:** ${sector.name} in MARKDOWN phase. Institutions dumping. Stay away.`);
        }

        if (sectorRotation) {
            if (sectorRotation.flowChange > 1) {
                parts.push(`🚀 Flow accelerating +$${sectorRotation.flowChange.toFixed(2)}M — institutions rotating IN.`);
            } else if (sectorRotation.flowChange < -1) {
                parts.push(`🔻 Flow deteriorating $${sectorRotation.flowChange.toFixed(2)}M — institutions rotating OUT.`);
            }
        }

        return parts.join('\n');
    }

    _moodEmoji(mood) {
        const map = {
            'HEAVY_BUYING': '🚀🚀',
            'BUYING': '🚀',
            'LIGHT_BUYING': '👍',
            'NEUTRAL': '➖',
            'LIGHT_SELLING': '⚠️',
            'SELLING': '🔻',
            'HEAVY_SELLING': '🔻🔻'
        };
        return map[mood] || '➖';
    }

    _buildExecutiveSummary(mood, rotation, signals, sectors) {
        const parts = [];

        // Mood headline
        parts.push(`## ${this._moodEmoji(mood.mood)} Institutional Mood: ${mood.mood.replace(/_/g, ' ')}`);
        parts.push(`**Phase:** ${mood.phase} | **Strength:** ${mood.strength}/100 | **Signal:** ${mood.signal}`);
        parts.push(`**Action:** ${mood.action}`);

        // Key flow numbers
        parts.push(`\n**Flows Today:** FIPI $${mood.fipiNet.toFixed(2)}M | Local $${mood.localNet.toFixed(2)}M | Combined $${(mood.fipiNet + mood.localNet).toFixed(2)}M`);

        // Rotation
        if (rotation.rotating) {
            parts.push(`\n🔄 **Rotation Detected:** ${rotation.rotationStyle.description}`);
            if (rotation.hotSectors.length > 0) {
                parts.push(`**Rotate IN:** ${rotation.hotSectors.map(s => s.name).join(', ')}`);
            }
            if (rotation.coldSectors.length > 0) {
                parts.push(`**Rotate OUT:** ${rotation.coldSectors.map(s => s.name).join(', ')}`);
            }
        }

        // Signal summary
        const sigSum = signals.summary;
        parts.push(`\n📊 **Signals:** ${sigSum.entries} entries (${sigSum.strongEntries} strong), ${sigSum.exits} exits, ${sigSum.trims} trims`);

        // Top opportunities
        const topAccum = sectors.filter(s => s.mood === 'ACCUMULATION').slice(0, 2);
        const topMarkup = sectors.filter(s => s.mood === 'MARKUP').slice(0, 2);

        if (topAccum.length > 0) {
            parts.push(`\n💎 **Accumulation Opportunities:** ${topAccum.map(s => s.name).join(', ')}`);
        }
        if (topMarkup.length > 0) {
            parts.push(`📈 **Trending:** ${topMarkup.map(s => s.name).join(', ')}`);
        }

        // Warnings
        const warnings = sectors.filter(s => s.mood === 'DISTRIBUTION').slice(0, 2);
        if (warnings.length > 0) {
            parts.push(`\n⚠️ **Distribution Warnings:** ${warnings.map(s => s.name).join(', ')}`);
        }

        // Divergences
        if (mood.divergences && mood.divergences.length > 0) {
            parts.push(`\n🔍 **Divergence Alert:** ${mood.divergences[0].message}`);
        }

        return parts.join('\n');
    }

    clearCache() {
        this.cache = null;
        this.lastUpdate = 0;
    }
}

module.exports = new SectorAnalysisService();