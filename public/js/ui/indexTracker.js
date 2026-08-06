// Index Tracker tab
const UIIndexTracker = {
    render(data) {
        const btn = document.getElementById('refreshIndexBtn');
        if (btn) {
            btn.textContent = '🔄 Refresh Index Data';
            btn.disabled = false;
        }
        
        if (!data) return;
        
        const kse = data.kse100;
        
        // Current value
        if (kse.current) {
            document.getElementById('idxValue').textContent = kse.current.toLocaleString();
            const ch = kse.changePercent || 0;
            const chEl = document.getElementById('idxChange');
            chEl.textContent = `${ch >= 0 ? '+' : ''}${kse.change?.toFixed(2) || '0.00'} (${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%)`;
            chEl.style.color = ch >= 0 ? 'var(--green)' : 'var(--red)';
        }
        
        // Stats
        document.getElementById('idxOpen').textContent = kse.open?.toLocaleString() || '-';
        document.getElementById('idxHigh').textContent = kse.high?.toLocaleString() || '-';
        document.getElementById('idxLow').textContent = kse.low?.toLocaleString() || '-';
        document.getElementById('idxVol').textContent = formatVol(kse.volume);
        
        // Volume analysis
        const remarks = data.volumeAnalysis?.remarks || [];
        document.getElementById('idxRemarks').innerHTML = remarks.map(r => 
            `<div class="remark">${r}</div>`
        ).join('') || 'No data yet';
        
        // Trend
        const trendIcons = {
            SURGING: '🔥', RISING: '📈', STEADY: '➖',
            SLOWING: '🔻', FALLING: '📉', INIT: '📊'
        };
        document.getElementById('idxTrendIcon').textContent = trendIcons[data.volumeAnalysis?.trend] || '📊';
        document.getElementById('idxTrendLabel').textContent = data.volumeAnalysis?.trend || 'INIT';
        document.getElementById('idxPeakTime').textContent = data.volumeAnalysis?.peakTime || '-';
        document.getElementById('idxPeakVol').textContent = data.volumeAnalysis?.peakVolume ? 
            formatVol(data.volumeAnalysis.peakVolume) : '-';
        
        // Table entries
        const entries = kse.entries || [];
        if (!entries.length) {
            document.getElementById('idxTableBody').innerHTML = 
                '<tr><td colspan="8" style="padding:20px;color:var(--text2)">No entries yet — data collects every 15 min</td></tr>';
            return;
        }
        
        const maxVol = Math.max(...entries.map(e => e.volume), 1);
        document.getElementById('idxTableBody').innerHTML = entries
            .sort((a, b) => b.time.localeCompare(a.time))
            .map(e => {
                const chClass = e.changePercent >= 0 ? 'up' : 'down';
                const volClass = e.volume > maxVol * 0.7 ? 'vol-high' : e.volume < maxVol * 0.3 ? 'vol-low' : '';
                const signal = e.changePercent > 0.5 ? '🟢' : e.changePercent < -0.5 ? '🔴' : '⚪';
                const valAdded = e.valueAdded || 0;
                const valClass = valAdded >= 0 ? 'up' : 'down';
                const sessionLabel = e.session || '-';
                
                return `<tr>
                    <td class="time-col">${e.time}</td>
                    <td><b>${e.value?.toLocaleString()}</b></td>
                    <td class="${chClass}">${e.change >= 0 ? '+' : ''}${e.change?.toFixed(2) || '0'}</td>
                    <td class="${chClass}">${e.changePercent >= 0 ? '+' : ''}${e.changePercent?.toFixed(2)}%</td>
                    <td class="${valClass}">${valAdded >= 0 ? '+' : ''}${valAdded.toFixed(2)}</td>
                    <td class="${volClass}">${formatVol(e.volume)}</td>
                    <td>${signal}</td>
                    <td style="font-size:9px;color:var(--text2)">${sessionLabel}</td>
                </tr>`;
            }).join('');
    }
};