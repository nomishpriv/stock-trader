'use strict';

/**
 * ================================================================
 * AUTO-TRADER SERVICE v1.0
 * Purpose: Automatically execute trades ONLY on blue-chip stocks
 *          with the highest quality signals.
 * Safety:  Strict whitelist, position limits, no averaging down.
 * ================================================================
 */

const tradeJournal = require('./tradeJournalService');

class AutoTraderService {
    constructor() {
        this.enabled = false;
        this.maxOpenPositions = 3;
        this.maxCapitalPerTrade = 0.10; // 10% of total capital
        this.totalCapital = 1000000;    // Rs. 10L default, update via config
        this.openAutoTrades = [];       // Track auto-trade IDs

        // Blue-chip whitelist (KSE-100 heavyweights only)
        this.whitelist = new Set([
            'OGDC', 'PPL', 'POL', 'MARI', 'HUBC', 'ENGRO', 'EFERT', 'FATIMA',
            'FFC', 'LUCK', 'MLCF', 'DGKC', 'PSO', 'ATRL', 'HCAR', 'MEBL',
            'MCB', 'HBL', 'UBL', 'BAFL', 'LCI', 'AGP', 'SEARL', 'GLAXO',
            'NATF', 'ABOT', 'COLG', 'PNSC', 'SAZEW', 'SRVI', 'GHNI', 'PIOC',
            'THALL', 'DCR', 'BFBIO'
        ]);
    }

    setConfig(config) {
        if (config.enabled !== undefined) this.enabled = config.enabled;
        if (config.maxOpenPositions) this.maxOpenPositions = config.maxOpenPositions;
        if (config.maxCapitalPerTrade) this.maxCapitalPerTrade = config.maxCapitalPerTrade;
        if (config.totalCapital) this.totalCapital = config.totalCapital;
        if (config.whitelist) this.whitelist = new Set(config.whitelist);
    }

    /**
     * Check if auto-trading is allowed right now
     */
    canTrade() {
        if (!this.enabled) return { allowed: false, reason: 'Auto-trading disabled' };

        const now = new Date();
        const pkTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
        const hours = pkTime.getHours();
        const minutes = pkTime.getMinutes();
        const day = pkTime.getDay();

        // Weekend check
        if (day === 0 || day === 6) {
            return { allowed: false, reason: 'Weekend' };
        }

        // Friday early close
        if (day === 5 && (hours > 15 || (hours === 15 && minutes >= 30))) {
            return { allowed: false, reason: 'Friday market closed' };
        }

        // Regular hours only: 9:32 - 15:30
        const timeInMinutes = hours * 60 + minutes;
        const marketStart = 9 * 60 + 32;
        const marketEnd = 15 * 60 + 30;

        if (timeInMinutes < marketStart) {
            return { allowed: false, reason: 'Pre-market' };
        }
        if (timeInMinutes > marketEnd - 30) { // No new trades in last 30 min
            return { allowed: false, reason: 'Market closing soon' };
        }

        // Position limit check
        const openPositions = tradeJournal.openTrades.filter(t => t.source === 'AUTO_TRADER');
        if (openPositions.length >= this.maxOpenPositions) {
            return { allowed: false, reason: `Max ${this.maxOpenPositions} auto positions reached` };
        }

        return { allowed: true, reason: 'OK' };
    }

    /**
     * Evaluate a signal for auto-execution
     */
    evaluateSignal(signal) {
        const check = this.canTrade();
        if (!check.allowed) {
            return { execute: false, reason: check.reason };
        }

        // Whitelist check
        if (!this.whitelist.has(signal.symbol)) {
            return { execute: false, reason: 'Not in blue-chip whitelist' };
        }

        // Quality checks (stricter than manual)
        if (signal.score < 15) {
            return { execute: false, reason: `Score ${signal.score} < 15` };
        }
        if (signal.riskReward < 2.0) {
            return { execute: false, reason: `R:R ${signal.riskReward} < 2.0` };
        }
        if (signal.volume < 100000) {
            return { execute: false, reason: 'Volume too low' };
        }
        if (signal.riskLevel === 'HIGH') {
            return { execute: false, reason: 'Risk level too high' };
        }

        // Check if already in an open position for this symbol
        const existing = tradeJournal.openTrades.find(t => t.symbol === signal.symbol && t.source === 'AUTO_TRADER');
        if (existing) {
            return { execute: false, reason: 'Already in auto position for this symbol' };
        }

        return { execute: true, reason: 'All checks passed' };
    }

    /**
     * Execute an auto-trade
     */
    executeTrade(signal) {
        const evaluation = this.evaluateSignal(signal);
        if (!evaluation.execute) {
            return { success: false, reason: evaluation.reason };
        }

        // Calculate position size: 10% of capital, max 500 shares for expensive stocks
        const maxInvest = this.totalCapital * this.maxCapitalPerTrade;
        let quantity = Math.floor(maxInvest / signal.entryPrice);

        // Cap quantity for risk management
        if (quantity > 1000) quantity = 1000;
        if (quantity < 100) quantity = 100; // Minimum lot size

        const trade = tradeJournal.openTrade({
            symbol: signal.symbol,
            name: signal.name,
            signal: signal.signal,
            tradeType: signal.tradeType,
            entryPrice: signal.entryPrice,
            targetPrice: signal.targetPrice,
            stopLoss: signal.stopLoss,
            riskReward: signal.riskReward,
            riskLevel: signal.riskLevel,
            quantity: quantity,
            source: 'AUTO_TRADER'
        });

        this.openAutoTrades.push(trade.id);

        return {
            success: true,
            tradeId: trade.id,
            symbol: signal.symbol,
            quantity,
            entryPrice: signal.entryPrice,
            target: signal.targetPrice,
            stop: signal.stopLoss,
            invested: quantity * signal.entryPrice
        };
    }

    /**
     * Scan all signals and auto-execute eligible ones
     */
    scanAndExecute(signals) {
        const results = [];
        for (const signal of signals) {
            if (signal.autoTradeEligible) {
                const result = this.executeTrade(signal);
                results.push(result);
            }
        }
        return results;
    }

    /**
     * Get auto-trader status
     */
    getStatus() {
        const openPositions = tradeJournal.openTrades.filter(t => t.source === 'AUTO_TRADER');
        const todayClosed = tradeJournal.closedTrades.filter(t => 
            t.source === 'AUTO_TRADER' && 
            t.exitDate && 
            t.exitDate.startsWith(new Date().toISOString().split('T')[0])
        );

        const todayPnl = todayClosed.reduce((s, t) => s + (t.finalPnl || 0), 0);

        return {
            enabled: this.enabled,
            canTrade: this.canTrade().allowed,
            openPositions: openPositions.length,
            maxPositions: this.maxOpenPositions,
            todayTrades: todayClosed.length,
            todayPnl: +todayPnl.toFixed(2),
            capitalUtilized: openPositions.reduce((s, t) => s + t.totalCost, 0),
            totalCapital: this.totalCapital
        };
    }
}

module.exports = new AutoTraderService();
