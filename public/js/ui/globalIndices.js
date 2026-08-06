// Global Indices tab
const UIGlobalIndices = {
    render(data) {
        if (!data) return;
        
        // Sentiment badge
        const badge = document.getElementById('giSentimentBadge');
        const sentiment = data.marketSummary?.globalSentiment || 'NEUTRAL';
        const sc = {
            BULLISH: { bg: '#22c55e', text: '#000', icon: '🟢' },
            BEARISH: { bg: '#ef4444', text: '#fff', icon: '🔴' }
        };
        const s = sc[sentiment] || { bg: '#f59e0b', text: '#000', icon: '🟡' };
        if (badge) {
            badge.textContent = `${s.icon} Global Markets: ${sentiment}`;
            badge.style.background = s.bg;
            badge.style.color = s.text;
        }
        
        // Region summaries
        const regions = data.marketSummary || {};
        this.updateRegion('giAsiaChange', regions.asia);
        this.updateRegion('giEuropeChange', regions.europe);
        this.updateRegion('giAmericasChange', regions.americas);
        
        // Grouped indices
        const grouped = data.grouped || {};
        let html = '';
        const regionIcons = {
            'Asia': '🌏', 'Middle East': '🌍', 'Europe': '🇪🇺',
            'Americas': '🌎', 'Commodities': '💎'
        };
        
        ['Asia', 'Middle East', 'Europe', 'Americas', 'Commodities'].forEach(region => {
            const indices = grouped[region] || [];
            if (!indices.length) return;
            
            html += `<div class="gi-region-title">${regionIcons[region] || '📊'} ${region}</div>`;
            
            indices.forEach(idx => {
                const chgClass = idx.changePercent >= 0 ? 'up' : 'down';
                const sign = idx.changePercent >= 0 ? '+' : '';
                const stateClass = idx.marketState || 'CLOSED';
                
                html += `<div class="gi-index-row">
                    <span class="gi-flag">${idx.flag}</span>
                    <span class="gi-name">
                        ${idx.name}
                        <span class="gi-country">${idx.country} 
                            <span class="gi-market-state ${stateClass}">${stateClass}</span>
                        </span>
                    </span>
                    <span class="gi-price">${idx.price?.toLocaleString() || '--'}</span>
                    <span class="gi-change ${chgClass}">${sign}${idx.changePercent?.toFixed(2)}%</span>
                </div>`;
            });
        });
        
        document.getElementById('giIndicesList').innerHTML = html || '<div class="empty-state">No data available</div>';
        
        // KSE comparison
        const kseEl = document.getElementById('giKseCompare');
        if (kseEl && State.kse100) {
            const asianAvg = regions.asia?.change || 0;
            const diff = (State.kse100.changePercent || 0) - asianAvg;
            const out = diff > 0;
            kseEl.textContent = out ? 
                `🟢 KSE-100 OUTPERFORMING Asia by +${diff.toFixed(2)}%` : 
                `🔴 KSE-100 UNDERPERFORMING Asia by ${diff.toFixed(2)}%`;
            kseEl.style.color = out ? 'var(--green)' : 'var(--red)';
        }
    },

    updateRegion(elId, rd) {
        const el = document.getElementById(elId);
        if (!el || !rd) return;
        const chg = rd.change || 0;
        const sign = chg >= 0 ? '+' : '';
        el.textContent = `${sign}${chg.toFixed(2)}%`;
        el.style.color = chg >= 0 ? 'var(--green)' : 'var(--red)';
    }
};