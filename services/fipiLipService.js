'use strict';

const axios = require('axios');

const BASE_URL = 'https://scstrade.com/FIPILIPI.aspx';

// ─── CACHE & HISTORY ───────────────────────────────────────────────────────
let cache = {
    mainSum: null, mainSumDetails: null,
    fipi: null, lipi: null,
    fipiSector: null, fipiInvestor: null,
    ts: 0, fetching: false, lastError: null,
    // NEW: Historical snapshots for trend detection
    history: [] // { date, fipiNet, localNet, sectors: {...} }
};
const CACHE_TTL = 600000;
const FETCH_TIMEOUT = 15000;
const MAX_HISTORY = 30; // Keep 30 trading days

function getDateString(date) {
    const d = date || new Date();
    const day = d.getDay();
    if (day === 0) d.setDate(d.getDate() - 2);
    if (day === 6) d.setDate(d.getDate() - 1);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}

async function fetchFromSCS(endpoint, body) {
    try {
        const response = await axios.post(`${BASE_URL}/${endpoint}`, {
            ...body, _search: false, nd: Date.now(),
            rows: 1000, page: 1, sidx: '', sord: 'asc'
        }, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://scstrade.com/FIPILIPI.aspx',
                'Origin': 'https://scstrade.com'
            },
            timeout: FETCH_TIMEOUT,
            maxRedirects: 0,
            validateStatus: s => s >= 200 && s < 300
        });
        if (response.data && typeof response.data.d === 'string') {
            return JSON.parse(response.data.d);
        }
        return response.data?.d || response.data;
    } catch (e) {
        if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
            console.error(`⏱️ FIPI/LIPI timeout (${endpoint})`);
        } else if (e.response?.status === 403 || e.response?.status === 429) {
            console.error(`🚫 FIPI/LIPI blocked (${endpoint}): ${e.response?.status}`);
        } else {
            console.error(`❌ FIPI/LIPI error (${endpoint}): ${e.message}`);
        }
        return null;
    }
}

async function fetchAllFipiLipData(dateOverride) {
    const dateStr = getDateString(dateOverride);
    const body = { date1: dateStr, date2: dateStr };
    console.log(`📊 Fetching FIPI/LIPI for ${dateStr}...`);

    const results = {};
    results.mainSum = await fetchFromSCS('loadmainsum', body);
    if (!results.mainSum) {
        console.log('⚠️ Main sum fetch failed, aborting');
        return null;
    }
    await new Promise(r => setTimeout(r, 300));
    results.mainSumDetails = await fetchFromSCS('loadmainsumdetails', body);
    await new Promise(r => setTimeout(r, 300));
    const [lipi, fipi] = await Promise.all([
        fetchFromSCS('loadlipi', body),
        fetchFromSCS('loadfipi', body)
    ]);
    results.lipi = lipi; results.fipi = fipi;
    await new Promise(r => setTimeout(r, 300));
    results.fipiSector = await fetchFromSCS('loadfipisector', body);
    await new Promise(r => setTimeout(r, 300));
    results.fipiInvestor = await fetchFromSCS('loadfipiInvestor', body);
    results.date = dateStr;

    const successCount = Object.values(results).filter(v => v !== null && typeof v !== 'string').length;
    console.log(`📊 FIPI/LIPI fetch complete: ${successCount}/6 endpoints succeeded`);
    return results;
}

// ─── PROCESS DATA ──────────────────────────────────────────────────────────

function processSectorData(rawData) {
    if (!rawData?.fipiSector) {
        return { sectors: [], summary: {}, totals: { totalFipiNet: 0, totalLocalNet: 0, totalNetValue: 0 } };
    }
    const { fipiSector, mainSum, mainSumDetails } = rawData;
    const sectorMap = new Map();

    (fipiSector || []).forEach(item => {
        const sectorName = (item.FLSectorName || '').replace(' (mn$)', '');
        if (!sectorMap.has(sectorName)) {
            sectorMap.set(sectorName, {
                name: sectorName,
                totalBuyVol: 0, totalSellVol: 0,
                netValueUSD: 0, fipiNet: 0, localNet: 0,
                investors: {}
            });
        }
        const sector = sectorMap.get(sectorName);
        const type = item.FLTypeNew || 'UNKNOWN';
        const netVal = item.FLNetValueUSD || 0;
        sector.totalBuyVol += (item.FLBuyVolume || 0);
        sector.totalSellVol += Math.abs(item.FLSellVolume || 0);
        sector.netValueUSD += netVal;
        if (type === 'FIPI' || type.includes('FOREIGN') || type.includes('OVERSEAS')) {
            sector.fipiNet += netVal;
        } else {
            sector.localNet += netVal;
        }
        sector.investors[type] = {
            buyVol: item.FLBuyVolume || 0,
            sellVol: Math.abs(item.FLSellVolume || 0),
            netValueUSD: netVal
        };
    });

    const sectors = Array.from(sectorMap.values())
        .sort((a, b) => Math.abs(b.netValueUSD) - Math.abs(a.netValueUSD));

    return {
        sectors,
        mainSummary: {
            fipi: mainSum?.find(s => s.FLType === 'FIPI') || null,
            lipi: mainSum?.find(s => s.FLType === 'LIPI') || null,
            details: mainSumDetails || []
        },
        totals: {
            totalFipiNet: sectors.reduce((s, sec) => s + sec.fipiNet, 0),
            totalLocalNet: sectors.reduce((s, sec) => s + sec.localNet, 0),
            totalNetValue: sectors.reduce((s, sec) => s + sec.netValueUSD, 0)
        },
        topGainingSectors: sectors.filter(s => s.netValueUSD > 0).slice(0, 5),
        topLosingSectors: sectors.filter(s => s.netValueUSD < 0).slice(0, 5),
        sectorCount: sectors.length
    };
}

// NEW: Calculate flow momentum (3-day trend)
function calculateFlowMomentum(history, current) {
    if (!history || history.length < 2) return { fipiTrend: 'FLAT', localTrend: 'FLAT', acceleration: 0 };

    const recent = history.slice(-5); // Last 5 snapshots
    const fipiValues = recent.map(h => h.fipiNet);
    const localValues = recent.map(h => h.localNet);

    // Simple linear trend
    const fipiSlope = fipiValues.length > 1 ? 
        (fipiValues[fipiValues.length - 1] - fipiValues[0]) / fipiValues.length : 0;
    const localSlope = localValues.length > 1 ? 
        (localValues[localValues.length - 1] - localValues[0]) / localValues.length : 0;

    const fipiTrend = fipiSlope > 0.3 ? 'RISING' : fipiSlope < -0.3 ? 'FALLING' : 'FLAT';
    const localTrend = localSlope > 0.3 ? 'RISING' : localSlope < -0.3 ? 'FALLING' : 'FLAT';

    // Acceleration = today's change vs average change
    const avgDailyChange = fipiValues.length > 1 ? 
        fipiValues.slice(1).reduce((sum, val, i) => sum + (val - fipiValues[i]), 0) / (fipiValues.length - 1) : 0;
    const todayChange = fipiValues.length > 0 ? fipiValues[fipiValues.length - 1] - (fipiValues[fipiValues.length - 2] || 0) : 0;
    const acceleration = avgDailyChange !== 0 ? (todayChange - avgDailyChange) / Math.abs(avgDailyChange || 1) : 0;

    return { fipiTrend, localTrend, acceleration: parseFloat(acceleration.toFixed(2)) };
}

// NEW: Detect divergences between price and smart money
function detectDivergences(sectors, stockDataMap) {
    const divergences = [];
    sectors.forEach(sector => {
        // Find representative stock for sector
        const stock = stockDataMap?.[sector.name]?.[0];
        if (!stock) return;

        const priceChange = stock.changePercent || 0;
        const fipiFlow = sector.fipiNet || 0;

        // Bearish divergence: Price up, FIPI selling
        if (priceChange > 1.5 && fipiFlow < -0.3) {
            divergences.push({
                sector: sector.name,
                type: 'BEARISH',
                signal: 'DISTRIBUTION',
                message: `⚠️ ${sector.name}: Price +${priceChange.toFixed(1)}% but FIPI selling (-$${Math.abs(fipiFlow).toFixed(2)}M). Smart money distributing.`,
                strength: Math.min(5, Math.abs(priceChange) + Math.abs(fipiFlow))
            });
        }
        // Bullish divergence: Price down, FIPI buying
        else if (priceChange < -1.5 && fipiFlow > 0.3) {
            divergences.push({
                sector: sector.name,
                type: 'BULLISH',
                signal: 'ACCUMULATION',
                message: `💎 ${sector.name}: Price ${priceChange.toFixed(1)}% but FIPI buying (+$${fipiFlow.toFixed(2)}M). Smart money accumulating.`,
                strength: Math.min(5, Math.abs(priceChange) + Math.abs(fipiFlow))
            });
        }
    });
    return divergences.sort((a, b) => b.strength - a.strength);
}

// ─── MAIN EXPORT ────────────────────────────────────────────────────────────

async function getFipiLipData({ date, forceRefresh = false, stockData = null } = {}) {
    const now = Date.now();

    if (!forceRefresh && !date && cache.mainSum && (now - cache.ts) < CACHE_TTL) {
        console.log('📊 Using cached FIPI/LIPI data (age:', Math.round((now - cache.ts)/1000), 's)');
        const processed = processSectorData(cache);
        const momentum = calculateFlowMomentum(cache.history, processed.totals);
        const divergences = stockData ? detectDivergences(processed.sectors, stockData) : [];
        return {
            sectorAnalysis: processed,
            flowMomentum: momentum,
            divergences,
            history: cache.history,
            date: cache.date,
            cached: true
        };
    }

    if (cache.fetching) {
        console.log('📊 FIPI/LIPI fetch already in progress, returning cached');
        if (cache.mainSum) {
            const processed = processSectorData(cache);
            return {
                sectorAnalysis: processed,
                flowMomentum: calculateFlowMomentum(cache.history, processed.totals),
                divergences: stockData ? detectDivergences(processed.sectors, stockData) : [],
                history: cache.history,
                date: cache.date,
                cached: true
            };
        }
        return null;
    }

    cache.fetching = true;

    try {
        const rawData = await fetchAllFipiLipData(date);

        if (!rawData || !rawData.mainSum) {
            cache.fetching = false;
            if (cache.mainSum) {
                const processed = processSectorData(cache);
                return {
                    sectorAnalysis: processed,
                    flowMomentum: calculateFlowMomentum(cache.history, processed.totals),
                    divergences: stockData ? detectDivergences(processed.sectors, stockData) : [],
                    history: cache.history,
                    date: cache.date,
                    cached: true,
                    stale: true
                };
            }
            return null;
        }

        // NEW: Add to history
        const processed = processSectorData(rawData);
        const snapshot = {
            date: rawData.date,
            fipiNet: processed.totals.totalFipiNet,
            localNet: processed.totals.totalLocalNet,
            totalNet: processed.totals.totalNetValue,
            sectors: processed.sectors.reduce((map, s) => {
                map[s.name] = { fipiNet: s.fipiNet, localNet: s.localNet, netValue: s.netValueUSD };
                return map;
            }, {})
        };

        // Avoid duplicates
        const existingIdx = cache.history.findIndex(h => h.date === rawData.date);
        if (existingIdx >= 0) cache.history[existingIdx] = snapshot;
        else cache.history.push(snapshot);

        if (cache.history.length > MAX_HISTORY) cache.history.shift();

        cache = { ...rawData, history: cache.history, ts: now, fetching: false };

        const momentum = calculateFlowMomentum(cache.history, processed.totals);
        const divergences = stockData ? detectDivergences(processed.sectors, stockData) : [];

        return {
            sectorAnalysis: processed,
            flowMomentum: momentum,
            divergences,
            history: cache.history,
            date: rawData.date,
            cached: false
        };
    } catch (e) {
        console.error('❌ FIPI/LIPI fetch failed:', e.message);
        cache.fetching = false;
        if (cache.mainSum) {
            const processed = processSectorData(cache);
            return {
                sectorAnalysis: processed,
                flowMomentum: calculateFlowMomentum(cache.history, processed.totals),
                divergences: stockData ? detectDivergences(processed.sectors, stockData) : [],
                history: cache.history,
                date: cache.date,
                cached: true,
                stale: true
            };
        }
        return null;
    }
}

// Get weekly trend with history context
async function getWeeklyTrend() {
    const results = [];
    let attempts = 0;
    const maxAttempts = 5;

    for (let i = 0; i < 10 && attempts < maxAttempts; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        if (d.getDay() === 0 || d.getDay() === 6) continue;
        attempts++;

        try {
            const rawData = await fetchAllFipiLipData(d);
            if (rawData?.mainSum) {
                const processed = processSectorData(rawData);
                results.push({
                    date: rawData.date,
                    fipiNet: processed.totals.totalFipiNet,
                    localNet: processed.totals.totalLocalNet,
                    totalNet: processed.totals.totalNetValue,
                    topSectors: processed.topGainingSectors.slice(0, 3).map(s => ({
                        name: s.name, net: s.netValueUSD
                    })),
                    bottomSectors: processed.topLosingSectors.slice(0, 3).map(s => ({
                        name: s.name, net: s.netValueUSD
                    }))
                });
            }
        } catch (e) {
            console.error(`Error fetching data for ${d.toDateString()}:`, e.message);
        }
        await new Promise(r => setTimeout(r, 2000));
    }

    return results.reverse();
}

module.exports = { getFipiLipData, getWeeklyTrend, calculateFlowMomentum, detectDivergences };