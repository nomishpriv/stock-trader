// FIPI/LIPI tab
const UIFipiLipi = {
    render(data) {
        if (!data) return;
        
        const sa = data.sectorAnalysis;
        
        // FIPI Net
        if (sa?.mainSummary?.fipi) {
            const f = sa.mainSummary.fipi;
            const el = document.getElementById('fipiNetVal');
            el.textContent = '$' + (f.FLNetValueUSD || 0).toFixed(2) + 'M';
            el.style.color = f.FLNetValueUSD >= 0 ? 'var(--green)' : 'var(--red)';
        }
        
        // LIPI Net
        if (sa?.mainSummary?.lipi) {
            const l = sa.mainSummary.lipi;
            const el = document.getElementById('lipiNetVal');
            el.textContent = '$' + (l.FLNetValueUSD || 0).toFixed(2) + 'M';
            el.style.color = l.FLNetValueUSD >= 0 ? 'var(--green)' : 'var(--red)';
        }
        
        // Details breakdown
        const details = sa?.mainSummary?.details || [];
        const de = document.getElementById('fipiDetails');
        if (de && details.length) {
            de.innerHTML = details.map(d => {
                const n = d.FLNetValueUSD || 0;
                const c = n >= 0 ? 'var(--green)' : 'var(--red)';
                return `<div style="display:flex;justify-content:space-between;padding:8px 10px;background:var(--bg2);border-radius:6px;margin-bottom:3px;font-size:12px">
                    <span>${d.FLType}</span>
                    <span style="display:flex;gap:12px">
                        <span style="color:var(--green)">B:$${(d.FLBuyValue || 0).toFixed(2)}M</span>
                        <span style="color:var(--red)">S:$${(Math.abs(d.FLSellValue) || 0).toFixed(2)}M</span>
                        <span style="color:${c};font-weight:600">${n >= 0 ? '+' : ''}$${n.toFixed(2)}M</span>
                    </span>
                </div>`;
            }).join('');
        }
        
        // Sector-wise flow
        const sectors = sa?.sectors || [];
        const se = document.getElementById('fipiSectors');
        if (se && sectors.length) {
            const maxNet = Math.max(...sectors.map(s => Math.abs(s.netValueUSD)), 1);
            se.innerHTML = sectors.slice(0, 15).map(s => {
                const pct = Math.abs(s.netValueUSD) / maxNet * 100;
                const isPos = s.netValueUSD >= 0;
                return `<div style="margin-bottom:6px;cursor:pointer" onclick="UISectors.showStocks('${s.name}')">
                    <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
                        <span style="font-weight:600">${s.name}</span>
                        <span style="color:${isPos ? 'var(--green)' : 'var(--red)'}">${isPos ? '+' : ''}$${s.netValueUSD.toFixed(2)}M</span>
                    </div>
                    <div style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden">
                        <div style="height:100%;width:${pct}%;background:${isPos ? 'var(--green)' : 'var(--red)'};border-radius:3px"></div>
                    </div>
                    <div style="display:flex;gap:8px;font-size:9px;color:var(--text2);margin-top:2px">
                        <span>🌍 FIPI: ${s.fipiNet >= 0 ? '+' : ''}$${s.fipiNet.toFixed(2)}M</span>
                        <span>🏠 Local: ${s.localNet >= 0 ? '+' : ''}$${s.localNet.toFixed(2)}M</span>
                    </div>
                </div>`;
            }).join('');
        }
    }
};