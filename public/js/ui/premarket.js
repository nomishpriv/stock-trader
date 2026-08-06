// Pre-market tab
const UIPremarket = {
    analyze() {
        const btn = document.getElementById('analyzePreMarketBtn');
        const status = document.getElementById('premarketStatus');
        btn.disabled = true;
        btn.textContent = '⏳ Analyzing...';
        btn.style.opacity = '0.7';
        status.style.display = 'block';
        status.textContent = 'Fetching order books...';
        
        if (State.preMarketTimerInterval) {
            clearInterval(State.preMarketTimerInterval);
            State.preMarketTimerInterval = null;
        }
        
        WS.send({ type: 'ANALYZE_PREMARKET' });
    },

    render(data) {
        const btn = document.getElementById('analyzePreMarketBtn');
        const status = document.getElementById('premarketStatus');
        const timer = document.getElementById('premarketTimer');
        const summary = document.getElementById('premarketSummary');
        const results = document.getElementById('premarketAnalysisResults');
        const header = document.getElementById('premarketHeader');
        
        btn.disabled = false;
        btn.textContent = '🔄 Re-Run';
        btn.style.opacity = '1';
        
        if (!data.isPreMarket) {
            status.textContent = '⏰ ' + data.message;
            status.style.color = 'var(--orange)';
            status.style.display = 'block';
            timer.style.display = 'none';
            summary.style.display = 'none';
            results.innerHTML = '<div class="empty-state">' + data.message + '</div>';
            if (header) header.innerHTML = '🔮 Pre-Market — ' + data.message;
            return;
        }
        
        if (header) header.innerHTML = '🌅 <b>Pre-Market Active!</b>';
        header.style.background = '#1a0a2e';
        
        // Timer
        if (data.timeRemaining) {
            timer.style.display = 'block';
            timer.innerHTML = `⏰ <b>${data.timeRemaining} min</b> until open`;
            timer.className = data.timeRemaining <= 5 ? 'pm-timer-warning' : '';
            
            if (State.preMarketTimerInterval) clearInterval(State.preMarketTimerInterval);
            let remaining = data.timeRemaining * 60;
            State.preMarketTimerInterval = setInterval(() => {
                remaining--;
                if (remaining <= 0) {
                    clearInterval(State.preMarketTimerInterval);
                    timer.innerHTML = '🔔 <b>Market OPEN!</b>';
                    timer.style.background = 'var(--green)';
                    timer.style.color = '#000';
                } else {
                    const m = Math.floor(remaining / 60);
                    const s = remaining % 60;
                    timer.innerHTML = `⏰ <b>${m}:${s.toString().padStart(2, '0')}</b> until open`;
                    if (m < 2) timer.className = 'pm-timer-warning';
                }
            }, 1000);
        }
        
        summary.style.display = 'block';
        document.getElementById('pmStrongBuyCount').textContent = data.strongBuys || 0;
        document.getElementById('pmBuyCount').textContent = data.buys || 0;
        document.getElementById('pmTotalCount').textContent = data.total || 0;
        status.style.display = 'none';
        
        if (!data.signals || !data.signals.length) {
            results.innerHTML = '<div class="empty-state">No signals found</div>';
            return;
        }
        
        results.innerHTML = data.signals.map(s => {
            const cardClass = s.signalStrength === 'STRONG_BUY' ? 'strong-buy' : 
                              s.signalStrength === 'BUY' ? 'buy' : 
                              s.signalStrength === 'WATCH' ? 'watch' : '';
            const bc = {
                STRONG_BUY: { bg: '#22c55e', text: '#000' },
                BUY: { bg: '#4ade80', text: '#000' },
                WATCH: { bg: '#f59e0b', text: '#000' }
            };
            const b = bc[s.signalStrength] || { bg: '#94a3b8', text: '#fff' };
            
            return `<div class="pm-analysis-card ${cardClass}" onclick="App.openStock('${s.symbol}')">
                <span class="pm-signal-badge" style="background:${b.bg};color:${b.text}">${s.signalStrength.replace('_', ' ')}</span>
                <div style="font-weight:600;font-size:15px">${s.symbol}</div>
                <div style="font-size:11px;color:var(--text2)">${(s.name || '').substring(0, 25)}</div>
                <div style="display:flex;gap:12px;margin-top:6px;font-size:12px">
                    <span>Prev: <b>${s.previousClose?.toFixed(2)}</b></span>
                    <span style="color:${s.previousChange >= 0 ? 'var(--green)' : 'var(--red)'}">
                        ${s.previousChange >= 0 ? '+' : ''}${s.previousChange?.toFixed(2)}%
                    </span>
                    ${s.expectedGap ? `<span style="color:${s.expectedGap > 0 ? 'var(--green)' : 'var(--red)'}">Gap: ${s.expectedGap > 0 ? '+' : ''}${s.expectedGap}%</span>` : ''}
                </div>
                <div style="margin-top:8px">
                    <span style="font-size:12px;color:var(--text2)">Conf: </span>
                    <span style="font-weight:700;color:${s.confidence > 70 ? 'var(--green)' : s.confidence > 40 ? 'var(--orange)' : 'var(--red)'}">${s.confidence}%</span>
                    ${s.riskLevel ? `<span style="margin-left:8px;font-size:10px;padding:2px 8px;border-radius:6px;background:${s.riskLevel === 'LOW' ? 'var(--green)' : s.riskLevel === 'MEDIUM' ? 'var(--orange)' : 'var(--red)'}22;color:${s.riskLevel === 'LOW' ? 'var(--green)' : s.riskLevel === 'MEDIUM' ? 'var(--orange)' : 'var(--red)'}">${s.riskLevel}</span>` : ''}
                </div>
                ${s.buySignal ? `<div class="pm-entry-info">
                    <div><label style="color:var(--blue)">Entry</label><br><b>${s.suggestedEntry?.toFixed(2)}</b></div>
                    <div><label style="color:var(--green)">Target</label><br><b>${s.suggestedTarget?.toFixed(2)}</b></div>
                    <div><label style="color:var(--red)">Stop</label><br><b>${s.suggestedStop?.toFixed(2)}</b></div>
                </div>` : ''}
                <div class="pm-reasons">${s.reasons.map(r => `<span class="pm-reason">${r}</span>`).join('')}</div>
            </div>`;
        }).join('');
    }
};