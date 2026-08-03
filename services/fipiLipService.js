'use strict';

const axios = require('axios');

const BASE_URL = 'https://scstrade.com/FIPILIPI.aspx';

// Cache with longer TTL
let cache = {
    mainSum: null,
    mainSumDetails: null,
    fipi: null,
    lipi: null,
    fipiSector: null,
    fipiInvestor: null,
    ts: 0,
    fetching: false, // Prevent concurrent fetches
    lastError: null
};
const CACHE_TTL = 600000; // 10 minutes (longer since data updates daily)
const FETCH_TIMEOUT = 15000; // 15 seconds per request

function getDateString(date) {
    const d = date || new Date();
    // Only fetch on weekdays, use last weekday on weekends
    const day = d.getDay();
    if (day === 0) d.setDate(d.getDate() - 2); // Sunday -> Friday
    if (day === 6) d.setDate(d.getDate() - 1); // Saturday -> Friday
    
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}

async function fetchFromSCS(endpoint, body) {
    try {
        const response = await axios.post(`${BASE_URL}/${endpoint}`, {
            ...body,
            _search: false,
            nd: Date.now(),
            rows: 1000,
            page: 1,
            sidx: '',
            sord: 'asc'
        }, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://scstrade.com/FIPILIPI.aspx',
                'Origin': 'https://scstrade.com',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            timeout: FETCH_TIMEOUT,
            // Don't follow redirects
            maxRedirects: 0,
            validateStatus: function (status) {
                return status >= 200 && status < 300;
            }
        });
        
        // Response is { d: "..." } with JSON string inside
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

    // Fetch sequentially with delays to avoid rate limiting
    const results = {};
    
    // Fetch main summary first
    results.mainSum = await fetchFromSCS('loadmainsum', body);
    if (!results.mainSum) {
        console.log('⚠️ Main sum fetch failed, aborting');
        return null;
    }
    
    // Small delay
    await new Promise(r => setTimeout(r, 300));
    
    // Fetch details
    results.mainSumDetails = await fetchFromSCS('loadmainsumdetails', body);
    
    await new Promise(r => setTimeout(r, 300));
    
    // Fetch LIPI and FIPI in parallel (they're smaller)
    const [lipi, fipi] = await Promise.all([
        fetchFromSCS('loadlipi', body),
        fetchFromSCS('loadfipi', body)
    ]);
    results.lipi = lipi;
    results.fipi = fipi;
    
    await new Promise(r => setTimeout(r, 300));
    
    // Fetch sector data
    results.fipiSector = await fetchFromSCS('loadfipisector', body);
    
    await new Promise(r => setTimeout(r, 300));
    
    // Fetch investor data
    results.fipiInvestor = await fetchFromSCS('loadfipiInvestor', body);
    
    results.date = dateStr;
    
    const successCount = Object.values(results).filter(v => v !== null && typeof v !== 'string').length;
    console.log(`📊 FIPI/LIPI fetch complete: ${successCount}/6 endpoints succeeded`);
    
    return results;
}

// ─── PROCESS DATA ──────────────────────────────────────────────────────────

function processSectorData(rawData) {
    if (!rawData?.fipiSector) return { sectors: [], summary: {}, totals: { totalFipiNet: 0, totalLocalNet: 0, totalNetValue: 0 } };

    const { fipiSector, mainSum, mainSumDetails } = rawData;
    
    const sectorMap = new Map();
    
    (fipiSector || []).forEach(item => {
        const sectorName = (item.FLSectorName || '').replace(' (mn$)', '');
        if (!sectorMap.has(sectorName)) {
            sectorMap.set(sectorName, {
                name: sectorName,
                totalBuyVol: 0,
                totalSellVol: 0,
                netValueUSD: 0,
                fipiNet: 0,
                localNet: 0,
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

// ─── MAIN EXPORT ────────────────────────────────────────────────────────────

async function getFipiLipData({ date, forceRefresh = false } = {}) {
    const now = Date.now();
    
    // Return cached data if valid
    if (!forceRefresh && !date && cache.mainSum && (now - cache.ts) < CACHE_TTL) {
        console.log('📊 Using cached FIPI/LIPI data (age:', Math.round((now - cache.ts)/1000), 's)');
        return {
            sectorAnalysis: processSectorData(cache),
            date: cache.date,
            cached: true
        };
    }
    
    // Prevent concurrent fetches
    if (cache.fetching) {
        console.log('📊 FIPI/LIPI fetch already in progress, returning cached');
        if (cache.mainSum) {
            return {
                sectorAnalysis: processSectorData(cache),
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
            console.log('⚠️ No FIPI/LIPI data available');
            cache.fetching = false;
            // Return cached data even if expired
            if (cache.mainSum) {
                return {
                    sectorAnalysis: processSectorData(cache),
                    date: cache.date,
                    cached: true,
                    stale: true
                };
            }
            return null;
        }
        
        cache = { ...rawData, ts: now, fetching: false };
        
        return {
            sectorAnalysis: processSectorData(rawData),
            date: rawData.date,
            cached: false
        };
    } catch (e) {
        console.error('❌ FIPI/LIPI fetch failed:', e.message);
        cache.fetching = false;
        
        // Return stale cache if available
        if (cache.mainSum) {
            return {
                sectorAnalysis: processSectorData(cache),
                date: cache.date,
                cached: true,
                stale: true
            };
        }
        return null;
    }
}

// Get weekly trend - simplified to avoid too many requests
async function getWeeklyTrend() {
    // Only try last 3 trading days to reduce requests
    const results = [];
    let attempts = 0;
    const maxAttempts = 3;
    
    for (let i = 0; i < 7 && attempts < maxAttempts; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        
        // Skip weekends
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
                        name: s.name,
                        net: s.netValueUSD
                    }))
                });
            }
        } catch (e) {
            console.error(`Error fetching data for ${d.toDateString()}:`, e.message);
        }
        
        // Longer delay between requests
        await new Promise(r => setTimeout(r, 2000));
    }
    
    return results.reverse();
}

module.exports = { getFipiLipData, getWeeklyTrend };