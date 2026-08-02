'use strict';

const axios = require('axios');

// Free API for global indices (no key needed)
const API_URL = 'https://api.worldtradingdata.com/api/v1/stock';
const API_KEY = process.env.WORLD_TRADING_KEY || 'demo'; // demo works for limited calls

// Major global indices symbols
const GLOBAL_INDICES = [
    // Asia Pacific
    { symbol: '^N225', name: 'Nikkei 225', region: 'Asia', country: 'Japan', flag: '🇯🇵' },
    { symbol: '^HSI', name: 'Hang Seng', region: 'Asia', country: 'Hong Kong', flag: '🇭🇰' },
    { symbol: '^SSEC', name: 'Shanghai Composite', region: 'Asia', country: 'China', flag: '🇨🇳' },
    { symbol: '^BSESN', name: 'BSE Sensex', region: 'Asia', country: 'India', flag: '🇮🇳' },
    { symbol: '^NSEI', name: 'Nifty 50', region: 'Asia', country: 'India', flag: '🇮🇳' },
    { symbol: '^STI', name: 'Straits Times', region: 'Asia', country: 'Singapore', flag: '🇸🇬' },
    { symbol: '^AXJO', name: 'ASX 200', region: 'Asia', country: 'Australia', flag: '🇦🇺' },
    { symbol: '^JKSE', name: 'Jakarta Composite', region: 'Asia', country: 'Indonesia', flag: '🇮🇩' },
    
    // Middle East
    { symbol: '^TASI', name: 'Tadawul All Share', region: 'Middle East', country: 'Saudi Arabia', flag: '🇸🇦' },
    { symbol: '^DFMGI', name: 'Dubai Financial', region: 'Middle East', country: 'UAE', flag: '🇦🇪' },
    { symbol: '^ADI', name: 'Abu Dhabi Index', region: 'Middle East', country: 'UAE', flag: '🇦🇪' },
    { symbol: '^QE', name: 'Qatar Exchange', region: 'Middle East', country: 'Qatar', flag: '🇶🇦' },
    
    // Europe
    { symbol: '^FTSE', name: 'FTSE 100', region: 'Europe', country: 'UK', flag: '🇬🇧' },
    { symbol: '^GDAXI', name: 'DAX 40', region: 'Europe', country: 'Germany', flag: '🇩🇪' },
    { symbol: '^FCHI', name: 'CAC 40', region: 'Europe', country: 'France', flag: '🇫🇷' },
    { symbol: '^STOXX50E', name: 'Euro Stoxx 50', region: 'Europe', country: 'EU', flag: '🇪🇺' },
    { symbol: '^IBEX', name: 'IBEX 35', region: 'Europe', country: 'Spain', flag: '🇪🇸' },
    { symbol: '^MIB', name: 'FTSE MIB', region: 'Europe', country: 'Italy', flag: '🇮🇹' },
    
    // Americas
    { symbol: '^GSPC', name: 'S&P 500', region: 'Americas', country: 'USA', flag: '🇺🇸' },
    { symbol: '^DJI', name: 'Dow Jones', region: 'Americas', country: 'USA', flag: '🇺🇸' },
    { symbol: '^IXIC', name: 'NASDAQ', region: 'Americas', country: 'USA', flag: '🇺🇸' },
    { symbol: '^GSPTSE', name: 'TSX Composite', region: 'Americas', country: 'Canada', flag: '🇨🇦' },
    { symbol: '^BVSP', name: 'Bovespa', region: 'Americas', country: 'Brazil', flag: '🇧🇷' },
    
    // Commodities
    { symbol: 'CL=F', name: 'Crude Oil WTI', region: 'Commodities', country: 'Global', flag: '🛢️' },
    { symbol: 'BZ=F', name: 'Brent Crude', region: 'Commodities', country: 'Global', flag: '🛢️' },
    { symbol: 'GC=F', name: 'Gold', region: 'Commodities', country: 'Global', flag: '🥇' },
    { symbol: 'SI=F', name: 'Silver', region: 'Commodities', country: 'Global', flag: '🥈' },
];

// Alternative: Use Yahoo Finance (more reliable, no API key needed)
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

class GlobalIndicesService {
    constructor() {
        this.cache = { data: null, ts: 0 };
        this.cacheTTL = 300000; // 5 minutes
    }

    /**
     * Fetch global indices using Yahoo Finance API (free, no key needed)
     */
    async fetchGlobalIndices() {
        const now = Date.now();
        if (this.cache.data && (now - this.cache.ts) < this.cacheTTL) {
            return this.cache.data;
        }

        const indices = [];
        
        // Fetch in batches of 5 to avoid rate limiting
        const batchSize = 5;
        for (let i = 0; i < GLOBAL_INDICES.length; i += batchSize) {
            const batch = GLOBAL_INDICES.slice(i, i + batchSize);
            const promises = batch.map(async (idx) => {
                try {
                    // Yahoo Finance symbol conversion
                    const yahooSymbol = this.convertToYahooSymbol(idx.symbol);
                    const { data } = await axios.get(`${YAHOO_BASE}${yahooSymbol}`, {
                        params: {
                            range: '1d',
                            interval: '1d'
                        },
                        timeout: 5000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0'
                        }
                    });

                    const meta = data?.chart?.result?.[0]?.meta;
                    if (meta && meta.regularMarketPrice) {
                        const price = +meta.regularMarketPrice;
                        const prevClose = +(meta.previousClose || meta.chartPreviousClose || price);
                        const change = price - prevClose;
                        const changePercent = prevClose ? ((change / prevClose) * 100) : 0;
                        
                        return {
                            symbol: idx.symbol,
                            name: idx.name,
                            region: idx.region,
                            country: idx.country,
                            flag: idx.flag,
                            price: +price.toFixed(2),
                            change: +change.toFixed(2),
                            changePercent: +changePercent.toFixed(2),
                            currency: meta.currency || 'USD',
                            marketState: meta.marketState || 'CLOSED',
                            high: meta.regularMarketDayHigh,
                            low: meta.regularMarketDayLow,
                            volume: meta.regularMarketVolume
                        };
                    }
                } catch (e) {
                    // Silent fail for individual indices
                }
                return null;
            });

            const results = await Promise.all(promises);
            indices.push(...results.filter(Boolean));
            
            // Small delay between batches
            if (i + batchSize < GLOBAL_INDICES.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Sort by region
        const grouped = {
            'Asia': [],
            'Middle East': [],
            'Europe': [],
            'Americas': [],
            'Commodities': []
        };

        indices.forEach(idx => {
            if (grouped[idx.region]) {
                grouped[idx.region].push(idx);
            }
        });

        const failedCount = GLOBAL_INDICES.length - indices.length;
        const result = {
            indices,
            grouped,
            total: indices.length,
            failed: failedCount,  // ✅ ADDED: transparency about fetch failures
            timestamp: new Date().toISOString(),
            marketSummary: this.getMarketSummary(indices)
        };

        this.cache = { data: result, ts: now };
        return result;
    }

    /**
     * Convert common symbols to Yahoo Finance format
     */
    convertToYahooSymbol(symbol) {
        const map = {
            // Asia Pacific
            '^N225': '^N225',           // Nikkei 225
            '^HSI': '^HSI',             // Hang Seng
            '^SSEC': '000001.SS',       // Shanghai Composite
            '^BSESN': '^BSESN',         // BSE Sensex
            '^NSEI': '^NSEI',           // Nifty 50  ✅ ADDED
            '^STI': '^STI',             // Straits Times  ✅ ADDED
            '^AXJO': '^AXJO',           // ASX 200  ✅ ADDED
            '^JKSE': '^JKSE',           // Jakarta Composite  ✅ ADDED
            
            // Middle East
            '^TASI': '^TASI.SR',        // Tadawul All Share
            '^DFMGI': '^DFMGI',         // Dubai Financial
            '^ADI': '^ADI',             // Abu Dhabi Index  ✅ ADDED
            '^QE': '^QE',               // Qatar Exchange  ✅ ADDED
            
            // Europe
            '^FTSE': '^FTSE',           // FTSE 100
            '^GDAXI': '^GDAXI',         // DAX 40
            '^FCHI': '^FCHI',           // CAC 40
            '^STOXX50E': '^STOXX50E',   // Euro Stoxx 50
            '^IBEX': '^IBEX',           // IBEX 35  ✅ ADDED
            '^MIB': '^FTSEMIB',         // FTSE MIB  ✅ FIXED (was ^MIB, Yahoo uses ^FTSEMIB)
            
            // Americas
            '^GSPC': '^GSPC',           // S&P 500
            '^DJI': '^DJI',             // Dow Jones
            '^IXIC': '^IXIC',           // NASDAQ
            '^GSPTSE': '^GSPTSE',       // TSX Composite  ✅ ADDED
            '^BVSP': '^BVSP',           // Bovespa  ✅ ADDED
            
            // Commodities
            'CL=F': 'CL=F',             // Crude Oil WTI
            'BZ=F': 'BZ=F',             // Brent Crude
            'GC=F': 'GC=F',             // Gold
            'SI=F': 'SI=F',             // Silver
        };
        return map[symbol] || symbol;
    }

    /**
     * Generate market summary
     */
    getMarketSummary(indices) {
        const asian = indices.filter(i => i.region === 'Asia');
        const europe = indices.filter(i => i.region === 'Europe');
        const americas = indices.filter(i => i.region === 'Americas');
        
        const asianAvg = asian.length ? asian.reduce((s, i) => s + i.changePercent, 0) / asian.length : 0;
        const europeAvg = europe.length ? europe.reduce((s, i) => s + i.changePercent, 0) / europe.length : 0;
        const americasAvg = americas.length ? americas.reduce((s, i) => s + i.changePercent, 0) / americas.length : 0;

        return {
            asia: { change: +asianAvg.toFixed(2), status: asianAvg > 0 ? 'POSITIVE' : 'NEGATIVE' },
            europe: { change: +europeAvg.toFixed(2), status: europeAvg > 0 ? 'POSITIVE' : 'NEGATIVE' },
            americas: { change: +americasAvg.toFixed(2), status: americasAvg > 0 ? 'POSITIVE' : 'NEGATIVE' },
            globalSentiment: (asianAvg + europeAvg + americasAvg) / 3 > 0 ? 'BULLISH' : 'BEARISH'
        };
    }

    /**
     * Get quick summary for market bar
     */
    async getQuickSummary() {
        const data = await this.fetchGlobalIndices();
        const asianPos = data.indices.filter(i => i.region === 'Asia' && i.changePercent > 0).length;
        const asianTotal = data.indices.filter(i => i.region === 'Asia').length;
        
        return {
            asianPositive: asianPos,
            asianTotal,
            globalSentiment: data.marketSummary.globalSentiment,
            topMover: data.indices.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))[0]
        };
    }
}

module.exports = new GlobalIndicesService();