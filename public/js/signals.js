// Trading signals helper
const SignalHelper = {
    // Calculate entry score
    getEntryScore(stock) {
        let score = 0;
        
        if (stock.rsi < 30) score += 3;
        else if (stock.rsi < 40) score += 2;
        else if (stock.rsi < 50) score += 1;
        
        if (stock.price <= stock.s1 * 1.02) score += 2;
        if (stock.price <= stock.s2 * 1.02) score += 3;
        
        if (stock.volume > stock.volAvg10d * 1.5) score += 1;
        if (stock.volume > stock.volAvg10d * 2) score += 2;
        
        if (stock.bidAskRatio > 1.2) score += 1;
        if (stock.bidAskRatio > 1.5) score += 2;
        
        return score;
    },
    
    // Calculate exit score
    getExitScore(stock) {
        let score = 0;
        
        if (stock.rsi > 70) score += 3;
        else if (stock.rsi > 60) score += 2;
        else if (stock.rsi > 50) score += 1;
        
        if (stock.price >= stock.r1 * 0.98) score += 2;
        if (stock.price >= stock.r2 * 0.98) score += 3;
        
        if (stock.volume > stock.volAvg10d * 2) score += 1;
        if (stock.changePercent < -3) score += 2;
        
        if (stock.bidAskRatio < 0.8) score += 1;
        
        return score;
    },
    
    // Get signal strength label
    getStrengthLabel(score) {
        if (score >= 6) return { label: 'STRONG', color: '#a855f7' };
        if (score >= 4) return { label: 'MODERATE', color: '#f59e0b' };
        if (score >= 2) return { label: 'WEAK', color: '#94a3b8' };
        return { label: 'NONE', color: '#64748b' };
    }
};

window.SignalHelper = SignalHelper;