// Institutional Tracker tab
const UIInstitutional = {
    analyze() {
        const btn = document.getElementById('analyzeInstBtn');
        const status = document.getElementById('instStatus');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Scanning...';
            btn.style.opacity = '0.7';
        }
        if (status) {
            status.style.display = 'block';
            status.textContent = 'Analyzing order books...';
        }
        WS.send({ type: 'ANALYZE_INSTITUTIONAL' });
    },

    render(data) {
        const btn = document.getElementById('analyzeInstBtn');
        const status = document.getElementById('instStatus');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🔄 Re-Scan for Institutional Activity';
            btn.style.opacity = '1';
        }
        if (status) status.style.display = 'none';
        if (!data) return;
        
        // Signals
        const signals = data.signals || [];
        const signalsEl = document.getElementById('instSignals');
        
        if (signals.length) {
            const signalColors = {
                STRONG_INSTITUTIONAL_BUY: { cls: 'institutional', label: '🐋🐋 Strong Institutional Buy' },
                INSTITUTIONAL_BUY: { cls: 'buy', label: '🐋 Institutional Buy' },
                BUILDING: { cls: 'building', label: '📈 Building' },
                WATCH: { cls: 'watch', label: '👀 Watch' }
            };
            
            signalsEl.innerHTML = signals.map(s => {
                const sc = signalColors[s.signal] || { cls: '', label: s.signal };
                return `<div class="inst-signal-card ${sc.cls}" onclick="App.openStock('${s.symbol}')">
                    <span class="inst-signal-emoji">${s.emoji}</span>
                    <div style="font-weight:600;font-size:15px">
                        ${s.symbol} 
                        <span style="font-size:11px;color:var(--text2)">${(s.name || '').substring(0, 20)}</span>
                    </div>
                    <div style="font-size:12px;color:var(--text2);margin-top:2px">${sc.label} • Score: ${s.score}</div>
                    <div style="font-size:12px;margin-top:4px">
                        Rs. ${s.price?.toFixed(2)} 
                        <span style="color:${s.changePercent >= 0 ? 'var(--green)' : 'var(--red)'}">
                            ${s.changePercent >= 0 ? '+' : ''}${s.changePercent?.toFixed(2)}%
                        </span>
                    </div>
                    <div class="inst-entry-row">
                        <div><label style="color:var(--text2)">B/A Ratio</label><br>${s.bidAskRatio?.toFixed(1)}</div>
                        <div><label style="color:var(--text2)">Volume</label><br>${formatVol(s.volume)}</div>
                        <div><label style="color:var(--text2)">Score</label><br><b style="color:var(--purple)">${s.score}</b></div>
                        <div><label style="color:var(--text2)">Time</label><br>${s.time}</div>
                    </div>
                    ${s.reasons ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px">
                        ${s.reasons.map(r => `<span style="font-size:9px;padding:2px 6px;background:var(--bg3);border-radius:6px">${r}</span>`).join('')}
                    </div>` : ''}
                </div>`;
            }).join('');
        } else {
            signalsEl.innerHTML = '<div class="empty-state">No active institutional signals found</div>';
        }
        
        // Alerts
        const alerts = data.alerts || [];
        const alertsEl = document.getElementById('instAlerts');
        if (alerts.length) {
            alertsEl.innerHTML = alerts.map(a => `<div class="inst-alert-item" onclick="App.openStock('${a.symbol}')">
                <span style="font-weight:600">${a.emoji} ${a.symbol}</span> • 
                ${(a.signal || '').replace(/_/g, ' ')} • Score: ${a.score}
                <div style="font-size:10px;color:var(--text2);margin-top:2px">@ ${a.price?.toFixed(2)} | ${a.time}</div>
                ${a.reasons ? `<div style="font-size:9px;color:var(--text2);margin-top:2px">${a.reasons.join(' • ')}</div>` : ''}
            </div>`).join('');
        } else {
            alertsEl.innerHTML = '<div class="empty-state">No alerts yet — run scan to detect signals</div>';
        }
    }
};