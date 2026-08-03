'use strict';

// PSX Sector Mappings - maps stock symbols to their sectors
const SECTOR_MAPPINGS = {
    // Commercial Banks
    'ABL': 'Commercial Banks', 'AKBL': 'Commercial Banks', 'BAFL': 'Commercial Banks',
    'BIPL': 'Commercial Banks', 'BOK': 'Commercial Banks', 'BOP': 'Commercial Banks',
    'FABL': 'Commercial Banks', 'HBL': 'Commercial Banks', 'HMB': 'Commercial Banks',
    'JSBL': 'Commercial Banks', 'MCB': 'Commercial Banks', 'MEBL': 'Commercial Banks',
    'NBP': 'Commercial Banks', 'SCBPL': 'Commercial Banks', 'SNBL': 'Commercial Banks',
    'UBL': 'Commercial Banks', 'SILK': 'Commercial Banks',
    
    // Cement
    'ACPL': 'Cement', 'BWCL': 'Cement', 'CHCC': 'Cement', 'DGKC': 'Cement',
    'FCCL': 'Cement', 'FECTC': 'Cement', 'GWLC': 'Cement', 'KOHC': 'Cement',
    'LUCK': 'Cement', 'MLCF': 'Cement', 'PIOC': 'Cement', 'POWER': 'Cement',
    'THCCL': 'Cement',
    
    // Fertilizer
    'EFERT': 'Fertilizer', 'FFBL': 'Fertilizer', 'FFC': 'Fertilizer',
    'FATIMA': 'Fertilizer', 'AHCL': 'Fertilizer',
    
    // Oil and Gas Exploration
    'MARI': 'Oil and Gas Exploration Companies', 'OGDC': 'Oil and Gas Exploration Companies',
    'POL': 'Oil and Gas Exploration Companies', 'PPL': 'Oil and Gas Exploration Companies',
    
    // Oil and Gas Marketing
    'APL': 'Oil and Gas Marketing Companies', 'PSO': 'Oil and Gas Marketing Companies',
    'SHEL': 'Oil and Gas Marketing Companies', 'HASCOL': 'Oil and Gas Marketing Companies',
    
    // Technology and Communication
    'AIRLINK': 'Technology and Communication', 'AVN': 'Technology and Communication',
    'HUMNL': 'Technology and Communication', 'OCTOPUS': 'Technology and Communication',
    'PTCL': 'Technology and Communication', 'SYS': 'Technology and Communication',
    'TELENOR': 'Technology and Communication', 'WTL': 'Technology and Communication',
    'NETSOL': 'Technology and Communication', 'TRG': 'Technology and Communication',
    
    // Textile Composite
    'ADMM': 'Textile Composite', 'ANL': 'Textile Composite', 'ILP': 'Textile Composite',
    'KML': 'Textile Composite', 'KTML': 'Textile Composite', 'NCL': 'Textile Composite',
    'NML': 'Textile Composite', 'STML': 'Textile Composite',
    
    // Power Generation
    'HUBC': 'Power Generation and Distribution', 'KAPCO': 'Power Generation and Distribution',
    'KEL': 'Power Generation and Distribution', 'LPL': 'Power Generation and Distribution',
    'NCPL': 'Power Generation and Distribution', 'NPL': 'Power Generation and Distribution',
    'PKGP': 'Power Generation and Distribution', 'SEPCO': 'Power Generation and Distribution',
    
    // Food and Personal Care
    'COLG': 'Food and Personal Care Products', 'NESTLE': 'Food and Personal Care Products',
    'QUICE': 'Food and Personal Care Products', 'RMPL': 'Food and Personal Care Products',
    'SHEZ': 'Food and Personal Care Products', 'TREET': 'Food and Personal Care Products',
    'UPFL': 'Food and Personal Care Products',
    
    // Pharma
    'ABOT': 'Pharmaceuticals', 'AGP': 'Pharmaceuticals', 'FEROZ': 'Pharmaceuticals',
    'GLAXO': 'Pharmaceuticals', 'HINO': 'Pharmaceuticals', 'OTSU': 'Pharmaceuticals',
    'SEARL': 'Pharmaceuticals',
    
    // Auto
    'ATLH': 'Automobile Assembler', 'GHNI': 'Automobile Assembler', 
    'HCAR': 'Automobile Assembler', 'INDU': 'Automobile Assembler',
    'MTL': 'Automobile Assembler', 'PSMC': 'Automobile Assembler', 'SAZEW': 'Automobile Assembler',
    
    // Steel
    'ASTL': 'Engineering', 'CSAP': 'Engineering', 'ISL': 'Engineering',
    'MUGHAL': 'Engineering',
    
    // Insurance
    'AGIC': 'Insurance', 'ATIL': 'Insurance', 'EFUG': 'Insurance',
    'IGIHL': 'Insurance', 'PAKRI': 'Insurance', 'PINL': 'Insurance',
    
    // Refinery
    'ATRL': 'Refinery', 'NRL': 'Refinery', 'PRL': 'Refinery',
    
    // Other sectors
    'DCR': 'Chemical', 'ICI': 'Chemical', 'LOTCHEM': 'Chemical', 'SITC': 'Chemical',
    'ENGRO': 'Conglomerates', 'FFL': 'Conglomerates',
    'PTC': 'Tobacco', 'PAKT': 'Tobacco',
    'SRVI': 'Leather and Tanneries',
    'PIBTL': 'Transport', 'PIAA': 'Transport', 'PICT': 'Transport',
    'JVDC': 'Miscellaneous', 'GADT': 'Miscellaneous',
};

// Cache for sector-to-stocks reverse mapping
let sectorStocksCache = null;

function buildSectorStocksMap() {
    const map = new Map();
    Object.entries(SECTOR_MAPPINGS).forEach(([symbol, sector]) => {
        if (!map.has(sector)) map.set(sector, []);
        map.get(sector).push(symbol);
    });
    return map;
}

function getSectorForSymbol(symbol) {
    return SECTOR_MAPPINGS[symbol?.toUpperCase()] || 'All other Sectors';
}

function getStocksForSector(sectorName) {
    if (!sectorStocksCache) {
        sectorStocksCache = buildSectorStocksMap();
    }
    
    // Normalize sector name (remove " (mn$)" if present)
    const normalized = sectorName.replace(' (mn$)', '').trim();
    
    // Direct match
    if (sectorStocksCache.has(normalized)) {
        return sectorStocksCache.get(normalized);
    }
    
    // Partial match
    for (const [key, stocks] of sectorStocksCache) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return stocks;
        }
    }
    
    // If no match, return empty (these are "All other Sectors")
    return [];
}

function getAllSectors() {
    if (!sectorStocksCache) {
        sectorStocksCache = buildSectorStocksMap();
    }
    return Array.from(sectorStocksCache.keys()).sort();
}

module.exports = {
    getSectorForSymbol,
    getStocksForSector,
    getAllSectors,
    SECTOR_MAPPINGS
};