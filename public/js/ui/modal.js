// Stock detail modal
const UIModal = {
    render(stock) {
        State.currentModalSymbol = stock.symbol;
        
        // Update all modal fields
        const fields = {
            modalSymbol: stock.symbol,
            modalName: stock.name || '',
            modalPrice: stock.price?.toFixed(2) || '0.00',
            modalOpen: stock.open?.toFixed(2) || '-',
            modalHigh: stock.high?.toFixed(2) || '-',
            modalLow: stock.low?.toFixed(2) || '-',
            modalVolume: formatVol(stock.volume),
            modalRSI: stock.rsi?.toFixed(1) || '-',
            modalPE: stock.pe?.toFixed(2) || '-',
            modalR2: stock.r2?.toFixed(2) || '-',
            modalR1: stock.r1?.toFixed(2) || '-',
            modalPivot: stock.pivot?.toFixed(2) || '-',
            modalS1: stock.s1?.toFixed(2) || '-',
            modalS2: stock.s2?.toFixed(2) || '-'
        };

        Object.entries(fields).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        });

        // Change percent
        const ch = stock.changePercent || 0;
        const changeEl = document.getElementById('modalChange');
        changeEl.textContent = `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`;
        changeEl.className = 'change ' + (ch >= 0 ? 'up' : 'down');

        // Signal badge
        const badge = document.getElementById('modalSignalBadge');
        const sig = stock.signal || 'NEUTRAL';
        badge.textContent = sig.replace('_', ' ');
        const sc = {
            'STRONG_BUY': '#22c55e', 'BUY': '#4ade80',
            'STRONG_SELL': '#ef4444', 'SELL': '#f87171',
            'NEUTRAL': '#94a3b8'
        };
        const col = sc[sig] || '#94a3b8';
        badge.style.background = col + '33';
        badge.style.color = col;

        // Watchlist button
        const btn = document.getElementById('modalWatchlistBtn');
        btn.textContent = State.watchlist.includes(stock.symbol) ? '⭐' : '☆';
        btn.onclick = () => App.toggleWatchlist(stock.symbol);
    },

    updateFromCache(sym) {
        if (State.currentModalSymbol !== sym) return;
        const s = State.stockMap.get(sym);
        if (!s) return;

        const mp = document.getElementById('modalPrice');
        const ce = document.getElementById('modalChange');
        
        if (mp) mp.textContent = s.price?.toFixed(2) || '0.00';
        if (ce) {
            const ch = s.changePercent || 0;
            ce.textContent = `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`;
            ce.className = 'change ' + (ch >= 0 ? 'up' : 'down');
        }

        ['modalVolume', 'modalHigh', 'modalLow', 'modalOpen', 'modalRSI'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = id === 'modalVolume' ? formatVol(s.volume) :
                    id === 'modalHigh' ? (s.high?.toFixed(2) || '-') :
                    id === 'modalLow' ? (s.low?.toFixed(2) || '-') :
                    id === 'modalOpen' ? (s.open?.toFixed(2) || '-') :
                    (s.rsi?.toFixed(1) || '-');
            }
        });
    },

    updatePrice(np, op) {
        const mp = document.getElementById('modalPrice');
        if (!mp) return;
        mp.textContent = np?.toFixed(2) || '0.00';
        mp.style.color = np > op ? '#22c55e' : np < op ? '#ef4444' : '';
        setTimeout(() => mp.style.color = '', 1000);
    }
};