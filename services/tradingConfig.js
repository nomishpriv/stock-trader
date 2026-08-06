/**
 * ================================================================
 * TRADING SYSTEM CONFIGURATION
 * Adjust these values to tune the system behavior
 * ================================================================
 */

module.exports = {
    // Signal Quality Gates
    signals: {
        minPrice: 20,              // Reject stocks below Rs. 20
        minVolume: 50000,          // Minimum daily volume
        maxSpreadPercent: 3.0,     // Max intraday range as % of price
        minRiskReward: 1.5,        // Minimum R:R to show any signal
        minRiskRewardAuto: 2.0,    // Minimum R:R for auto-trade
        minScoreAuto: 15,          // Minimum score for auto-trade
        minStopPercent: {
            blueChip: 1.5,         // 1.5% stop for blue chips
            standard: 2.5          // 2.5% stop for others
        }
    },

    // Blue-Chip Whitelist (Auto-Trade Only)
    blueChips: [
        'OGDC', 'PPL', 'POL', 'MARI', 'HUBC', 'ENGRO', 'EFERT', 'FATIMA',
        'FFC', 'LUCK', 'MLCF', 'DGKC', 'PSO', 'ATRL', 'HCAR', 'MEBL',
        'MCB', 'HBL', 'UBL', 'BAFL', 'LCI', 'AGP', 'SEARL', 'GLAXO',
        'NATF', 'ABOT', 'COLG', 'PNSC', 'SAZEW', 'SRVI', 'GHNI', 'PIOC',
        'THALL', 'DCR', 'BFBIO'
    ],

    // Auto-Trader Settings
    autoTrader: {
        enabled: true,            // Set to true to enable auto-trading
        maxOpenPositions: 3,       // Max concurrent auto positions
        maxCapitalPerTrade: 0.10,  // 10% of capital per trade
        totalCapital: 1000000,     // Rs. 10 Lakhs
        noNewTradesAfter: '14:45', // Don't enter new positions after 2:45 PM
    },

    // Risk Management
    risk: {
        maxDailyLoss: -50000,      // Stop trading after Rs. 50K loss
        maxOpenExposure: 500000,   // Max Rs. 5L in open positions
        maxTradesPerDay: 20,       // Prevent over-trading
        brokerageRate: 0.001,      // 0.1% per side
        taxRate: 0.0002            // 0.02% CVT
    },

    // Market Regime
    market: {
        maxIndexDecline: -1.5,     // Don't trade if KSE-100 down > 1.5%
        maxDeclinerRatio: 0.70,    // Don't trade if > 70% stocks red
        requireUptrend: true       // Only trade if price > EMA20
    }
};
