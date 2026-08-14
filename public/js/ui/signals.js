// Trading Signals tab
const UISignals = {
    render(data) {
        if (!data || !data.length) {
            document.getElementById('signalsList').innerHTML = '<div class="empty-state">No signals</div>';
            return;
        }
        
        let filtered = data;
        if (State.currentSignalFilter === 'DAY') filtered = data.filter(s => s.tradeType.includes('DAY'));
        else if (State.currentSignalFilter === 'SWING') filtered = data.filter(s => s.tradeType.includes('SWING'));
        else if (State.currentSignalFilter === 'STRONG_BUY') filtered = data.filter(s => s.signal === 'STRONG_BUY');
        
        document.getElementById('signalsList').innerHTML = filtered.map(s => {
            const escapedName = (s.name || '').replace(/'/g, "\\'");
            const qty = calculateTradeQuantity(s.entryPrice, s.stopLoss);
            const riskRs = Math.abs(s.entryPrice - s.stopLoss) * qty;
            const canTake = (s.journalEligible !== false) && s.score >= CONFIG.MIN_SIGNAL_SCORE_TAKE &&
                s.signal !== 'WEAK_BUY' && s.signal !== 'NEUTRAL';
            const takeBtn = canTake
                ? `<button class="tj-btn tj-btn-take" onclick="event.stopPropagation();UITradeJournal.takeTradeFromSignal({
                    symbol:'${s.symbol}', name:'${escapedName}', signal:'${s.signal}',
                    tradeType:'${s.tradeType}', entryPrice:${s.entryPrice},
                    targetPrice:${s.targetPrice}, stopLoss:${s.stopLoss},
                    riskReward:${s.riskReward}, riskLevel:'${s.riskLevel}'
                }, ${qty})" style="margin-top:4px;width:100%">📒 Take Trade (${qty} sh · risk Rs.${riskRs.toFixed(0)})</button>`
                : `<div style="font-size:10px;color:var(--orange);text-align:center;margin-top:6px">⚠️ Score too low — manual review only</div>`;
            return `<div class="signal-card" style="border-left-color:${s.color}" onclick="App.openStock('${s.symbol}')">
                <div class="signal-header">
                    <div>
                        <span style="font-weight:600;font-size:15px">${s.emoji} ${s.symbol}</span>
                        <span class="trade-type-badge" style="background:${s.color}22;color:${s.color};margin-left:8px">${s.tradeType}</span>
                    </div>
                    <span class="signal-score" style="background:${s.color}22;color:${s.color}">${s.signal.replace('_', ' ')}</span>
                </div>
                <div style="font-size:13px">
                    Rs. ${s.price?.toFixed(2)} 
                    <span style="color:${s.change >= 0 ? 'var(--green)' : 'var(--red)'}">
                        ${s.change >= 0 ? '+' : ''}${s.change?.toFixed(2)}%
                    </span>
                </div>
                <div class="signal-reasons">
                    ${s.reasons.map(r => `<span class="signal-reason-tag">${r}</span>`).join('')}
                </div>
                <div class="signal-trade-info">
                    <div class="entry"><label>Entry</label><br>${s.entryPrice?.toFixed(2)}</div>
                    <div class="target"><label>Target</label><br>${s.targetPrice?.toFixed(2)}</div>
                    <div class="stop"><label>Stop</label><br>${s.stopLoss?.toFixed(2)}</div>
                </div>
                <div style="font-size:10px;color:var(--text2);text-align:center;margin-top:4px">
                    R:R ${s.riskReward}:1 | Risk: ${s.riskLevel}
                </div>
                ${takeBtn}
            </div>`;
        }).join('');
    }
};