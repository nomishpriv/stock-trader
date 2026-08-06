// Utility functions
function formatVol(v) {
    if (!v) return '0';
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(0) + 'K';
    return v.toString();
}

function getSignalBg(s) {
    const m = {
        'STRONG_BUY': '#22c55e',
        'BUY': '#4ade80',
        'HOLD': '#f59e0b',
        'SELL': '#f87171',
        'STRONG_SELL': '#ef4444'
    };
    return m[s] || '#94a3b8';
}

function formatTradeDateTime(isoDate) {
    if (!isoDate) return '--';
    try {
        const d = new Date(isoDate);
        const dateStr = d.toLocaleDateString('en-PK', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        const timeStr = d.toLocaleTimeString('en-PK', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
        return `${dateStr} ${timeStr}`;
    } catch (e) {
        return isoDate;
    }
}

function getSourceLabel(source) {
    if (!source) return '';
    const labels = {
        'AUTO_TRADER': '🤖 Auto',
        'SIGNAL_TAB': '📊 Signal',
        'MANUAL': '✋ Manual'
    };
    const bg = source === 'AUTO_TRADER' ? 'rgba(168,85,247,0.2)' : 'rgba(59,130,246,0.2)';
    const color = source === 'AUTO_TRADER' ? '#a855f7' : '#3b82f6';
    return `<span style="font-size:9px;padding:2px 6px;border-radius:6px;background:${bg};color:${color}">${labels[source] || source}</span>`;
}

function getTradeDuration(entryDate, exitDate) {
    if (!entryDate || !exitDate) return '--';
    try {
        const entry = new Date(entryDate);
        const exit = new Date(exitDate);
        const diffMs = exit - entry;
        if (diffMs < 0) return '--';

        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return '< 1 min';
        if (diffMins < 60) return `${diffMins} min`;

        const hours = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        if (hours < 24) return `${hours}h ${mins}m`;

        const days = Math.floor(hours / 24);
        const remainHours = hours % 24;
        return `${days}d ${remainHours}h ${mins}m`;
    } catch (e) {
        return '--';
    }
}

function showToast() {
    const t = document.getElementById('toast');
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 1500);
}

function stockCard(stock) {
    const ch = stock.changePercent || 0;
    return `<div class="stock-card" data-symbol="${stock.symbol}" onclick="App.openStock('${stock.symbol}')">
        <div class="stock-main">
            <div>
                <div class="stock-symbol">${stock.symbol}</div>
                <div class="stock-name">${(stock.name || '').substring(0, 20)}</div>
            </div>
            <div>
                <div class="stock-price" style="transition:color 0.3s">${stock.price?.toFixed(2) || '0.00'}</div>
                <div class="stock-change ${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</div>
            </div>
        </div>
        <div class="stock-stats">
            <span>Vol: ${formatVol(stock.volume)}</span>
            <span>RSI: ${stock.rsi?.toFixed(1) || '-'}</span>
        </div>
    </div>`;
}