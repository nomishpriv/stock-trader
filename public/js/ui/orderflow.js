// Order Flow tab
const UIOrderFlow = {
    render(data) {
        if (!data) return;
        
        const s = data.summary || {};
        
        // Pressure badge
        const badge = document.getElementById('ofPressureBadge');
        const pressures = {
            STRONG_BUY: { bg: '#22c55e', text: '#000', label: '🔥 Strong Buy Pressure' },
            BUY: { bg: '#4ade80', text: '#000', label: '📈 Buy Pressure' },
            NEUTRAL: { bg: '#f59e0b', text: '#000', label: '➖ Neutral' },
            SELL: { bg: '#f87171', text: '#fff', label: '📉 Sell Pressure' },
            STRONG_SELL: { bg: '#ef4444', text: '#fff', label: '🔴 Strong Sell Pressure' }
        };
        const p = pressures[s.pressure] || pressures['NEUTRAL'];
        if (badge) {
            badge.textContent = p.label;
            badge.style.background = p.bg;
            badge.style.color = p.text;
        }
        
        // Summary cards
        document.getElementById('ofBuyVol').textContent = formatVol(s.totalBuyVolume || 0);
        document.getElementById('ofSellVol').textContent = formatVol(s.totalSellVolume || 0);
        
        const netFlow = s.netFlow || 0;
        const netEl = document.getElementById('ofNetFlow');
        netEl.textContent = (netFlow >= 0 ? '+' : '') + formatVol(Math.abs(netFlow));
        netEl.style.color = netFlow >= 0 ? 'var(--green)' : 'var(--red)';
        
        document.getElementById('ofBuyRatio').textContent = (s.buyRatio || 50) + '%';
        document.getElementById('ofTotalTrades').textContent = (s.totalTrades || 0) + ' trades';
        
        // Remarks
        const remarks = data.remarks || [];
        document.getElementById('ofRemarks').innerHTML = remarks.map(r => 
            `<div style="padding:2px 0">${r}</div>`
        ).join('') || 'No data yet';
        
        // Top stocks
        const topStocks = data.topStocks || [];
        if (topStocks.length) {
            const maxFlow = Math.max(...topStocks.map(s => Math.abs(s.netFlow)), 1);
            document.getElementById('ofTopStocks').innerHTML = topStocks.map(s => {
                const buyPct = s.buyRatio || 50;
                const isPos = s.netFlow >= 0;
                return `<div class="of-stock-row" onclick="App.openStock('${s.symbol}')">
                    <span class="of-sym">${s.symbol}</span>
                    <div class="of-bar-wrap">
                        <div class="of-bar-buy" style="width:${buyPct}%"></div>
                        <div class="of-bar-sell" style="width:${100 - buyPct}%"></div>
                    </div>
                    <span class="of-ratio" style="color:${isPos ? 'var(--green)' : 'var(--red)'}">${buyPct}%</span>
                    <span style="font-size:10px;min-width:50px;text-align:right;color:${isPos ? 'var(--green)' : 'var(--red)'}">
                        ${isPos ? '+' : ''}${formatVol(Math.abs(s.netFlow))}
                    </span>
                </div>`;
            }).join('');
        }
        
        // Hourly flow
        const hourly = data.hourlyFlow || [];
        if (hourly.length) {
            const maxVol = Math.max(...hourly.map(h => h.buyVolume + h.sellVolume), 1);
            document.getElementById('ofHourlyChart').innerHTML = hourly.map(h => {
                const buyH = Math.max(2, ((h.buyVolume / maxVol) * 70));
                const sellH = Math.max(2, ((h.sellVolume / maxVol) * 70));
                return `<div class="of-hourly-col">
                    <div class="bar buy" style="height:${buyH}px"></div>
                    <div class="bar sell" style="height:${sellH}px"></div>
                    <span class="time">${h.hour}</span>
                </div>`;
            }).join('');
        }
        
        // Large trades
        const largeTrades = data.largeTrades || [];
        document.getElementById('ofLargeTrades').innerHTML = largeTrades.length ? 
            largeTrades.map(t => `<div class="of-large-trade ${t.side.toLowerCase()}" onclick="App.openStock('${t.symbol}')">
                <span><b>${t.symbol}</b></span>
                <span style="color:${t.side === 'BUY' ? 'var(--green)' : 'var(--red)'}">${t.side}</span>
                <span>@${t.price?.toFixed(2)}</span>
                <span>${formatVol(t.volume)}</span>
                <span style="font-size:10px;color:var(--text2)">Rs.${(t.value / 1000).toFixed(0)}K</span>
            </div>`).join('') :
            '<div style="text-align:center;padding:10px;color:var(--text2);font-size:12px">No large trades yet</div>';
    },

    updateSummary(data) {
        if (data.pressure === 'STRONG_BUY' || data.pressure === 'BUY') {
            const ms = document.getElementById('marketSignal');
            if (ms && data.buyRatio) {
                const existing = ms.innerHTML;
                if (!existing.includes('Flow:')) {
                    ms.innerHTML += ` <span style="font-size:10px;padding:3px 6px;background:var(--green);color:#000;border-radius:6px">Flow: ${data.buyRatio}% Buy</span>`;
                }
            }
        }
    }
};