// Sectors tab
const UISectors = {
    render(data) {
        if (!data?.sectors) return;
        let sectors = data.sectors;
        
        // Apply filters
        if (State.currentSectorFilter === 'strongbuy') sectors = sectors.filter(s => s.recommendation === 'STRONG_BUY');
        else if (State.currentSectorFilter === 'buy') sectors = sectors.filter(s => ['BUY', 'ACCUMULATE'].includes(s.recommendation));
        else if (State.currentSectorFilter === 'gaining') sectors = sectors.filter(s => s.avgChange > 0);
        else if (State.currentSectorFilter === 'losing') sectors = sectors.filter(s => s.avgChange < 0);
        else if (State.currentSectorFilter === 'fipi') sectors = sectors.filter(s => Math.abs(s.fipiNet) > 0.05);
        else if (State.currentSectorFilter === 'lowrisk') sectors = sectors.filter(s => s.riskLevel === 'LOW');
        
        const list = document.getElementById('sectorsList');
        if (!list) return;
        if (!sectors.length) {
            list.innerHTML = '<div class="empty-state">No sectors match this filter</div>';
            return;
        }
        
        list.innerHTML = sectors.map(s => {
            const scorePct = Math.min(100, Math.max(0, (s.compositeScore + 25) / 50 * 100));
            const buySig = (s.signalCounts?.buy || 0) + (s.signalCounts?.strongBuy || 0);
            const sellSig = (s.signalCounts?.sell || 0) + (s.signalCounts?.strongSell || 0);
            
            return `<div class="stock-card" style="border-left:4px solid ${s.recColor || '#94a3b8'}">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                    <span style="font-weight:700;font-size:15px">🏭 ${s.name}</span>
                    <span class="sector-rec-badge" style="background:${s.recColor || '#94a3b8'}22;color:${s.recColor || '#94a3b8'}">
                        ${s.recEmoji || '➖'} ${s.recommendation?.replace(/_/g, ' ') || 'HOLD'}
                    </span>
                </div>
                <div class="sector-score-bar">
                    <div class="sector-score-fill" style="width:${scorePct}%;background:${s.recColor || '#94a3b8'}"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text2);margin-bottom:6px">
                    <span>Score: ${s.compositeScore > 0 ? '+' : ''}${s.compositeScore?.toFixed(1) || 0}</span>
                    <span>Risk: ${s.riskLevel}</span>
                </div>
                <div class="sector-narrative">${s.narrative || ''}</div>
                <div class="sector-metric-row">
                    <span class="sector-metric" style="color:${s.trend === 'BULLISH' ? 'var(--green)' : s.trend === 'BEARISH' ? 'var(--red)' : 'var(--text2)'}">📈 ${s.trend}</span>
                    <span class="sector-metric" style="color:${s.moneyFlow === 'INFLOW' ? 'var(--green)' : s.moneyFlow === 'OUTFLOW' ? 'var(--red)' : 'var(--text2)'}">💰 ${s.moneyFlow}</span>
                    <span class="sector-metric" style="color:${s.smartMoney === 'ACCUMULATING' ? 'var(--green)' : s.smartMoney === 'DISTRIBUTING' ? 'var(--red)' : 'var(--text2)'}">🐋 ${s.smartMoney}</span>
                    <span class="sector-metric">📊 RSI ${s.avgRSI?.toFixed(1) || '-'}</span>
                    <span class="sector-metric" style="color:${s.avgChange >= 0 ? 'var(--green)' : 'var(--red)'}">📉 Avg ${s.avgChange >= 0 ? '+' : ''}${s.avgChange?.toFixed(2) || 0}%</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:11px;margin-top:6px">
                    <div style="background:var(--bg3);padding:6px;border-radius:6px;text-align:center">
                        <div style="color:var(--text2)">🌍 FIPI</div>
                        <div style="color:${s.fipiNet >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:600">${s.fipiNet >= 0 ? '+' : ''}$${s.fipiNet?.toFixed(2) || 0}M</div>
                    </div>
                    <div style="background:var(--bg3);padding:6px;border-radius:6px;text-align:center">
                        <div style="color:var(--text2)">🏠 Local</div>
                        <div style="color:${s.localNet >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:600">${s.localNet >= 0 ? '+' : ''}$${s.localNet?.toFixed(2) || 0}M</div>
                    </div>
                    <div style="background:var(--bg3);padding:6px;border-radius:6px;text-align:center">
                        <div style="color:var(--text2)">🎯 Algo</div>
                        <div style="font-weight:600">${buySig}B / ${sellSig}S</div>
                    </div>
                </div>
                ${s.topStocks?.length ? `<div style="margin-top:8px">
                    <div style="font-size:10px;color:var(--text2);margin-bottom:4px">🏆 Top Movers</div>
                    <div class="sector-top-stocks">
                        ${s.topStocks.map(st => `<span onclick="event.stopPropagation();App.openStock('${st.symbol}')">
                            ${st.symbol} <span style="color:${st.change >= 0 ? 'var(--green)' : 'var(--red)'}">${st.change >= 0 ? '+' : ''}${st.change?.toFixed(1) || 0}%</span>
                        </span>`).join('')}
                    </div>
                </div>` : ''}
                <button class="tj-btn tj-btn-take" onclick="event.stopPropagation();UISectors.showStocks('${s.name}')" style="margin-top:8px;width:100%;font-size:12px;padding:8px">
                    📊 View ${s.stockCount} Stocks in ${s.name}
                </button>
            </div>`;
        }).join('');
    },

    showStocks(sectorName) {
        WS.send({ type: 'GET_SECTOR_STOCKS', sector: sectorName });
    },

    renderSectorStocks(sectorName, stocks) {
        if (!stocks || !stocks.length) {
            showToast();
            return;
        }
        
        State.sectorFilterSymbols = stocks.map(s => s.symbol);
        State.currentSectorName = sectorName;
        State.currentFilter = 'sector';
        
        // Switch to market tab
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const mb = document.querySelector('[data-tab="market"]');
        if (mb) mb.classList.add('active');
        
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.getElementById('marketTab').classList.add('active');
        
        document.querySelectorAll('#marketTab [data-filter]').forEach(b => b.classList.remove('active'));
        
        UIMarket.render();
        showToast();
    }
};