'use strict';

/**
 * SECTOR ROTATION SERVICE
 * =======================
 * Detects when institutions are rotating capital between sectors.
 * 
 * Key Insight: Smart money doesn't just buy/sell the market — they ROTATE.
 * When they exit Banks and pile into Cement, you want to know BEFORE the move completes.
 * 
 * Rotation Types:
 *   DEFENSIVE    → Moving to safe sectors (Pharma, FMCG) = risk-off
 *   OFFENSIVE    → Moving to cyclicals (Banks, Cement, Auto) = risk-on  
 *   QUALITY      → Moving to large-cap, profitable names = uncertainty
 *   MOMENTUM     → Chasing hot sectors = FOMO phase
 */

const { getAllSectors, getStocksForSector } = require('./sectorMappingService');

const SECTOR_CATEGORIES = {
    defensive: ['Pharmaceuticals', 'Food and Personal Care Products', 'Tobacco', 'Insurance'],
    offensive: ['Commercial Banks', 'Cement', 'Automobile Assembler', 'Oil and Gas Exploration Companies', 'Technology and Communication'],
    cyclical: ['Cement', 'Steel', 'Engineering', 'Textile Composite'],
    interestSensitive: ['Commercial Banks', 'Insurance', 'Power Generation and Distribution'],
    commodity: ['Oil and Gas Exploration Companies', 'Oil and Gas Marketing Companies', 'Refinery', 'Fertilizer'],
    growth: ['Technology and Communication', 'Pharmaceuticals'],
    value: ['Commercial Banks', 'Cement', 'Power Generation and Distribution']
};

class SectorRotationService {
    constructor() {
        this.rotationHistory = []; // Track rotation patterns over time
        this.maxHistory = 30;
    }

    /**
     * Detect sector rotation from FIPI/LIPI flow changes
     */
    detectRotation(currentSectors, history = []) {
        if (!currentSectors || currentSectors.length === 0) {
            return { rotating: false, message: 'No sector data available' };
        }

        // Calculate sector momentum (change in FIPI flow vs previous periods)
        const sectorMomentums = currentSectors.map(sector => {
            const historical = this._getSectorHistory(sector.name, history);
            const currentFipi = sector.fipiNet || 0;
            const currentLocal = sector.localNet || 0;

            // Previous period average
            const prevFipi = historical.length > 0 
                ? historical.reduce((s, h) => s + (h.fipiNet || 0), 0) / historical.length 
                : 0;
            const prevLocal = historical.length > 0
                ? historical.reduce((s, h) => s + (h.localNet || 0), 0) / historical.length
                : 0;

            const fipiDelta = currentFipi - prevFipi;
            const localDelta = currentLocal - prevLocal;
            const combinedDelta = fipiDelta * 2 + localDelta; // FIPI weighted

            // Trend direction
            let trend;
            if (historical.length >= 2) {
                const recent = historical.slice(-3);
                const improving = recent.every((h, i) => i === 0 || (h.fipiNet || 0) >= recent[i-1].fipiNet);
                const deteriorating = recent.every((h, i) => i === 0 || (h.fipiNet || 0) <= recent[i-1].fipiNet);
                if (improving) trend = 'IMPROVING';
                else if (deteriorating) trend = 'DETERIORATING';
                else trend = 'MIXED';
            } else {
                trend = 'NEW';
            }

            return {
                name: sector.name,
                currentFipi: parseFloat(currentFipi.toFixed(2)),
                currentLocal: parseFloat(currentLocal.toFixed(2)),
                prevFipi: parseFloat(prevFipi.toFixed(2)),
                fipiDelta: parseFloat(fipiDelta.toFixed(2)),
                localDelta: parseFloat(localDelta.toFixed(2)),
                combinedDelta: parseFloat(combinedDelta.toFixed(2)),
                trend,
                // Categorization
                categories: this._categorizeSector(sector.name)
            };
        });

        // Sort by momentum
        sectorMomentums.sort((a, b) => b.combinedDelta - a.combinedDelta);

        // Identify rotations
        const hotSectors = sectorMomentums.filter(s => s.combinedDelta > 0.5).slice(0, 3);
        const coldSectors = sectorMomentums.filter(s => s.combinedDelta < -0.5).slice(-3);
        const improvingSectors = sectorMomentums.filter(s => s.trend === 'IMPROVING' && s.currentFipi > 0);
        const deterioratingSectors = sectorMomentums.filter(s => s.trend === 'DETERIORATING' && s.currentFipi < 0);

        // Detect rotation style
        const rotationStyle = this._classifyRotationStyle(hotSectors, coldSectors, sectorMomentums);

        // Build rotation narrative
        const narrative = this._buildRotationNarrative(rotationStyle, hotSectors, coldSectors, improvingSectors);

        // Generate trade ideas
        const tradeIdeas = this._generateRotationTrades(rotationStyle, hotSectors, coldSectors, sectorMomentums);

        const result = {
            timestamp: new Date().toISOString(),
            rotating: hotSectors.length > 0 && coldSectors.length > 0,
            rotationStyle,
            narrative,

            // Hot = money flowing IN
            hotSectors: hotSectors.map(s => ({
                name: s.name,
                fipiNet: s.currentFipi,
                flowChange: s.fipiDelta,
                trend: s.trend,
                signal: 'ROTATE_IN'
            })),

            // Cold = money flowing OUT  
            coldSectors: coldSectors.map(s => ({
                name: s.name,
                fipiNet: s.currentFipi,
                flowChange: s.fipiDelta,
                trend: s.trend,
                signal: 'ROTATE_OUT'
            })),

            // Improving = early rotation signal
            improvingSectors: improvingSectors.slice(0, 3).map(s => ({
                name: s.name,
                fipiNet: s.currentFipi,
                daysImproving: history.length > 0 ? Math.min(3, history.length) : 1,
                signal: 'EARLY_ENTRY'
            })),

            // Deteriorating = early exit signal
            deterioratingSectors: deterioratingSectors.slice(0, 3).map(s => ({
                name: s.name,
                fipiNet: s.currentFipi,
                daysDeteriorating: history.length > 0 ? Math.min(3, history.length) : 1,
                signal: 'EARLY_EXIT'
            })),

            tradeIdeas,

            // Full ranking
            allSectors: sectorMomentums.map(s => ({
                name: s.name,
                fipiNet: s.currentFipi,
                flowChange: s.combinedDelta,
                rank: 0 // filled below
            }))
        };

        // Add ranks
        result.allSectors.forEach((s, i) => s.rank = i + 1);

        // Store history
        this.rotationHistory.push({
            timestamp: result.timestamp,
            style: rotationStyle,
            hot: hotSectors.map(s => s.name),
            cold: coldSectors.map(s => s.name)
        });
        if (this.rotationHistory.length > this.maxHistory) this.rotationHistory.shift();

        return result;
    }

    _getSectorHistory(sectorName, history) {
        return history.map(h => ({
            date: h.date,
            fipiNet: h.sectors?.[sectorName]?.fipiNet || 0,
            localNet: h.sectors?.[sectorName]?.localNet || 0
        })).filter(h => h.fipiNet !== 0 || h.localNet !== 0);
    }

    _categorizeSector(sectorName) {
        const cats = [];
        for (const [cat, sectors] of Object.entries(SECTOR_CATEGORIES)) {
            if (sectors.some(s => sectorName.includes(s) || s.includes(sectorName))) {
                cats.push(cat);
            }
        }
        return cats;
    }

    _classifyRotationStyle(hotSectors, coldSectors, allSectors) {
        const hotCategories = new Set(hotSectors.flatMap(s => s.categories));
        const coldCategories = new Set(coldSectors.flatMap(s => s.categories));

        // Risk-on: Offensive/Cyclical hot, Defensive cold
        if ((hotCategories.has('offensive') || hotCategories.has('cyclical')) && 
            (coldCategories.has('defensive'))) {
            return { style: 'RISK_ON', emoji: '🚀', description: 'Institutions rotating INTO risk/cyclicals and OUT of defensives. Bullish for market.' };
        }

        // Risk-off: Defensive hot, Offensive cold
        if ((hotCategories.has('defensive')) && 
            (coldCategories.has('offensive') || coldCategories.has('cyclical'))) {
            return { style: 'RISK_OFF', emoji: '🛡️', description: 'Flight to safety — moving INTO defensives and OUT of cyclicals. Bearish warning.' };
        }

        // Quality: Value hot, Growth cold
        if ((hotCategories.has('value')) && (coldCategories.has('growth'))) {
            return { style: 'QUALITY', emoji: '💎', description: 'Rotation into value/profitability and out of speculative growth. Disciplined market.' };
        }

        // Growth chase: Growth hot, Value cold
        if ((hotCategories.has('growth')) && (coldCategories.has('value'))) {
            return { style: 'GROWTH_CHASE', emoji: '⚡', description: 'Chasing growth/momentum. Can be late-cycle behavior — exercise caution.' };
        }

        // Commodity: Commodity hot
        if (hotCategories.has('commodity')) {
            return { style: 'COMMODITY', emoji: '⛽', description: 'Commodity sectors seeing inflows. Often inflation-linked or global demand driven.' };
        }

        // Rate sensitive rotation
        if (hotCategories.has('interestSensitive') && coldCategories.has('interestSensitive')) {
            return { style: 'RATE_SENSITIVE', emoji: '🏦', description: 'Selective rotation within rate-sensitive sectors. Watch for policy clues.' };
        }

        return { style: 'SELECTIVE', emoji: '🔍', description: 'No broad thematic rotation. Stock-picking market — focus on individual names with FIPI inflows.' };
    }

    _buildRotationNarrative(style, hotSectors, coldSectors, improvingSectors) {
        const parts = [];
        parts.push(`${style.emoji} **Rotation Style: ${style.style.replace(/_/g, ' ')}**`);
        parts.push(style.description);

        if (hotSectors.length > 0) {
            const hotNames = hotSectors.map(s => `${s.name} (+$${s.fipiDelta.toFixed(2)}M)`).join(', ');
            parts.push(`📈 **Inflows:** ${hotNames}`);
        }

        if (coldSectors.length > 0) {
            const coldNames = coldSectors.map(s => `${s.name} ($${s.fipiDelta.toFixed(2)}M)`).join(', ');
            parts.push(`📉 **Outflows:** ${coldNames}`);
        }

        if (improvingSectors.length > 0) {
            const earlyNames = improvingSectors.slice(0, 2).map(s => s.name).join(', ');
            parts.push(`👀 **Early Rotation:** ${earlyNames} showing consistent FIPI improvement.`);
        }

        return parts.join('\n\n');
    }

    _generateRotationTrades(style, hotSectors, coldSectors, allSectors) {
        const ideas = [];

        // Primary rotation trade: Buy hot sector leaders
        hotSectors.forEach(sector => {
            const stocks = getStocksForSector(sector.name);
            if (stocks.length > 0) {
                ideas.push({
                    type: 'ROTATION_LONG',
                    sector: sector.name,
                    symbols: stocks.slice(0, 3),
                    rationale: `Institutions rotating INTO ${sector.name} (+$${sector.fipiDelta.toFixed(2)}M flow change). Buy sector leaders on any dip.`,
                    conviction: Math.min(5, Math.ceil(Math.abs(sector.combinedDelta))),
                    timeFrame: '1-4 weeks'
                });
            }
        });

        // Hedge/Exit: Sell cold sectors
        coldSectors.forEach(sector => {
            ideas.push({
                type: 'ROTATION_EXIT',
                sector: sector.name,
                rationale: `Institutions exiting ${sector.name} ($${sector.fipiDelta.toFixed(2)}M flow change). Reduce exposure, avoid new entries.`,
                conviction: Math.min(5, Math.ceil(Math.abs(sector.combinedDelta))),
                timeFrame: 'Immediate'
            });
        });

        // Pairs trade: Long hot / Short cold (for advanced)
        if (hotSectors.length > 0 && coldSectors.length > 0) {
            ideas.push({
                type: 'PAIRS_TRADE',
                longSector: hotSectors[0].name,
                shortSector: coldSectors[0].name,
                rationale: `Market-neutral pairs trade: Long ${hotSectors[0].name} (inflows) vs Short ${coldSectors[0].name} (outflows). Captures relative rotation.`,
                conviction: 3,
                timeFrame: '2-6 weeks',
                riskLevel: 'HIGH'
            });
        }

        // Mean reversion: If a sector is oversold but FIPI starting to buy
        allSectors.forEach(sector => {
            if (sector.currentFipi > 0 && sector.fipiDelta > 0.3 && sector.trend === 'IMPROVING') {
                const stocks = getStocksForSector(sector.name);
                if (stocks.length > 0 && !ideas.some(i => i.sector === sector.name)) {
                    ideas.push({
                        type: 'MEAN_REVERSION',
                        sector: sector.name,
                        symbols: stocks.slice(0, 2),
                        rationale: `${sector.name} FIPI turning positive after weakness. Potential mean-reversion play as smart money steps in.`,
                        conviction: 2,
                        timeFrame: '1-3 weeks'
                    });
                }
            }
        });

        return ideas.sort((a, b) => b.conviction - a.conviction);
    }

    getRotationHistory() {
        return this.rotationHistory;
    }

    /**
     * Detect if a specific sector is being accumulated by institutions
     */
    isSectorBeingAccumulated(sectorName, history = []) {
        const sectorHistory = this._getSectorHistory(sectorName, history);
        if (sectorHistory.length < 3) return false;

        const recent = sectorHistory.slice(-3);
        const improving = recent.every((h, i) => i === 0 || h.fipiNet >= recent[i-1].fipiNet);
        const allPositive = recent.every(h => h.fipiNet > 0);

        return improving && allPositive;
    }

    /**
     * Detect if a specific sector is being distributed
     */
    isSectorBeingDistributed(sectorName, history = []) {
        const sectorHistory = this._getSectorHistory(sectorName, history);
        if (sectorHistory.length < 3) return false;

        const recent = sectorHistory.slice(-3);
        const deteriorating = recent.every((h, i) => i === 0 || h.fipiNet <= recent[i-1].fipiNet);
        const allNegative = recent.every(h => h.fipiNet < 0);

        return deteriorating && allNegative;
    }
}

module.exports = new SectorRotationService();
