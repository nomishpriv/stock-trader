// Trade Journal tab
const UITradeJournal = {
    render(data) {
        if (!data) return;
        
        const s = data.summary || {};
        
        // Summary stats
        document.getElementById('tjOpen').textContent = s.openTrades || 0;
        document.getElementById('tjWins').textContent = s.totalWins || 0;
        document.getElementById('tjWinRate').textContent = (s.winRate || 0) + '%';
        document.getElementById('tjTodayPnl').textContent = 'Rs.' + (s.todayPnl || 0).toLocaleString();
        document.getElementById('tjTotalPnl').textContent = 'Rs.' + (s.totalPnl || 0).toLocaleString();
        document.getElementById('tjExposure').textContent = 'Rs.' + ((s.openExposure || 0) / 1000).toFixed(0) + 'K';
        
        // Open trades
        const openTrades = data.open || [];
        const openEl = document.getElementById('tjOpenTrades');
        if (openTrades.length) {
            openEl.innerHTML = openTrades.map(t => {
                const pnlClass = t.currentPnl >= 0 ? 'tj-pnl-positive' : 'tj-pnl-negative';
                const sourceLabel = getSourceLabel(t.source);
                const distStopPct = t.stopLoss ? ((t.currentPrice - t.stopLoss) / t.entryPrice * 100) : 999;
                const nearStop = distStopPct < 0.5 && distStopPct >= 0;
                const stopWarning = nearStop ? '<span style="color:var(--red);font-size:10px"> ⚠️ Near stop</span>' : '';
                return `<div class="tj-trade-card open" onclick="App.openStock('${t.symbol}')">
                    <div class="tj-trade-header">
                        <span>
                            <b>${t.symbol}</b> 
                            <span style="font-size:10px;color:var(--text2)">${t.tradeType}</span> 
                            ${sourceLabel}
                        </span>
                        <span class="${pnlClass}">
                            ${t.currentPnl >= 0 ? '+' : ''}Rs.${t.currentPnl?.toFixed(0)} 
                            (${t.currentPnlPercent >= 0 ? '+' : ''}${t.currentPnlPercent?.toFixed(2)}%)
                        </span>
                    </div>
                    <div style="font-size:11px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-top:4px">
                        <div>Entry: <b style="color:var(--blue)">${t.entryPrice?.toFixed(2)}</b></div>
                        <div>Target: <b style="color:var(--green)">${t.targetPrice?.toFixed(2)}</b></div>
                        <div>Stop: <b style="color:var(--red)">${t.stopLoss?.toFixed(2)}</b>${stopWarning}</div>
                    </div>
                    <div style="font-size:10px;color:var(--text2);margin-top:4px">
                        Qty: ${t.quantity} | Cost: Rs.${t.totalCost?.toFixed(0)} | ${formatTradeDateTime(t.entryDate)}
                    </div>
                    <div style="margin-top:4px;display:flex;gap:4px">
                        <button class="tj-btn tj-btn-close" onclick="event.stopPropagation();UITradeJournal.closeTrade('${t.id}',${t.currentPrice})">
                            Close @ ${t.currentPrice?.toFixed(2)}
                        </button>
                        <button class="tj-btn tj-btn-avg" onclick="event.stopPropagation();UITradeJournal.averageDown('${t.id}',${Math.floor(t.quantity / 2)},${t.currentPrice})">
                            Avg Down
                        </button>
                    </div>
                </div>`;
            }).join('');
        } else {
            openEl.innerHTML = '<div class="empty-state">No open trades</div>';
        }
        
        // Closed trades
        const closedTrades = data.closed || [];
        const closedEl = document.getElementById('tjClosedTrades');
        if (closedTrades.length) {
            closedEl.innerHTML = closedTrades.slice(0, CONFIG.MAX_CLOSED_TRADES).map(t => {
                const isWin = t.profit;
                const sourceLabel = getSourceLabel(t.source);
                const duration = getTradeDuration(t.entryDate, t.exitDate);
                
                return `<div class="tj-trade-card ${isWin ? 'win' : 'loss'}">
                    <div class="tj-trade-header">
                        <span>
                            <b>${t.symbol}</b> 
                            <span style="font-size:10px">${t.tradeType}</span> 
                            ${sourceLabel}
                        </span>
                        <span class="${isWin ? 'tj-pnl-positive' : 'tj-pnl-negative'}">
                            ${isWin ? '+' : ''}Rs.${t.finalPnl?.toFixed(0)} 
                            (${t.finalPnlPercent >= 0 ? '+' : ''}${t.finalPnlPercent?.toFixed(2)}%)
                        </span>
                    </div>
                    <div style="font-size:11px;display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px">
                        <div style="color:var(--text2)">
                            📥 Entry: <b style="color:var(--blue)">${formatTradeDateTime(t.entryDate)}</b>
                            <br><span style="font-size:10px">@ ${t.entryPrice?.toFixed(2)}</span>
                        </div>
                        <div style="color:var(--text2)">
                            📤 Exit: <b style="color:${isWin ? 'var(--green)' : 'var(--red)'}">${formatTradeDateTime(t.exitDate)}</b>
                            <br><span style="font-size:10px">@ ${t.exitPrice?.toFixed(2)}</span>
                        </div>
                    </div>
                    <div style="font-size:10px;color:var(--text2);margin-top:4px;display:flex;gap:12px;flex-wrap:wrap">
                        <span>⏱️ Duration: <b>${duration}</b></span>
                        <span>📊 R:R ${t.riskReward}:1</span>
                        <span>📦 Qty: ${t.quantity}</span>
                        <span>🏷️ ${(t.exitReason || '').replace(/_/g, ' ')}</span>
                    </div>
                </div>`;
            }).join('');
        } else {
            closedEl.innerHTML = '<div class="empty-state">No closed trades yet</div>';
        }
    },

    takeTradeFromSignal(signal, quantity) {
        WS.send({ type: 'TAKE_TRADE_FROM_SIGNAL', signal, quantity: quantity || CONFIG.DEFAULT_TRADE_QUANTITY });
    },

    closeTrade(tradeId, price) {
        if (confirm('Close trade at Rs.' + price?.toFixed(2) + '?')) {
            WS.send({ type: 'CLOSE_TRADE', tradeId, exitPrice: price, reason: 'MANUAL', note: 'Manual close' });
        }
    },

    averageDown(tradeId, qty, price) {
        if (confirm('Average down: Buy ' + qty + ' more shares @ Rs.' + price?.toFixed(2) + '?')) {
            WS.send({ type: 'AVERAGE_DOWN', tradeId, quantity: qty, price });
        }
    }
};