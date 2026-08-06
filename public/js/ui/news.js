// News tab
const UINews = {
    renderSignal(data) {
        if (!data) return;
        
        State.newsSignal = data;
        
        // Update market bar
        const ms = document.getElementById('marketSignal');
        if (ms) {
            ms.innerHTML = `AI: ${data.emoji} <span class="news-signal-mini" style="background:${getSignalBg(data.signal)}">${(data.signal || 'HOLD').replace('_', ' ')}</span>`;
        }
        
        // Hero section
        const hero = document.getElementById('newsSignalHero');
        if (hero) {
            hero.querySelector('.ns-emoji').textContent = data.emoji;
            hero.querySelector('.ns-text').textContent = `${(data.signal || 'HOLD').replace('_', ' ')} • ${data.sentiment}`;
            hero.querySelector('.ns-conf').textContent = data.confidence ? `Confidence: ${data.confidence}%` : '';
        }
        
        // Summary
        const sum = document.getElementById('newsSummaryBox');
        if (sum) {
            sum.innerHTML = data.summary ? 
                `<strong>📋 Summary:</strong> ${data.summary}<br><br><strong>⚡ Action:</strong> ${data.immediateAction || 'N/A'}` : '';
        }
        
        // Top trades
        const trd = document.getElementById('newsTradesList');
        if (trd && data.topTrades?.length) {
            trd.innerHTML = '<h4 style="margin-bottom:8px;font-size:13px">🎯 AI Top Trades</h4>' + 
                data.topTrades.map(t => `<div class="news-trade-item">
                    <span class="nt-ticker">${t.ticker}</span>
                    <span style="font-size:11px">${t.reason || ''}</span>
                    <span class="nt-action ${t.action?.toLowerCase()}">${t.action}</span>
                </div>`).join('');
        }
    },

    renderTicker(headlines) {
        const container = document.getElementById('newsTicker');
        if (!container) return;
        
        if (!headlines || !headlines.length) {
            container.innerHTML = '<div class="news-ticker-loading">No recent news</div>';
            return;
        }
        
        const now = Date.now();
        const tf = now - (24 * 60 * 60 * 1000);
        const recent = headlines.filter(h => {
            if (!h.pubDate) return true;
            return new Date(h.pubDate).getTime() > tf;
        }).sort((a, b) => {
            const aT = a.pubDate ? new Date(a.pubDate).getTime() : now;
            const bT = b.pubDate ? new Date(b.pubDate).getTime() : now;
            return bT - aT;
        });
        
        if (!recent.length) {
            container.innerHTML = '<div class="news-ticker-loading">No news in last 24h</div>';
            return;
        }
        
        let lastDate = null;
        let html = '';
        
        recent.forEach(h => {
            const pd = h.pubDate ? new Date(h.pubDate) : new Date();
            const dateStr = pd.toLocaleDateString('en-PK', { weekday: 'short', month: 'short', day: 'numeric' });
            const timeStr = pd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            
            if (dateStr !== lastDate) {
                const today = new Date().toLocaleDateString('en-PK', { weekday: 'short', month: 'short', day: 'numeric' });
                const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-PK', { weekday: 'short', month: 'short', day: 'numeric' });
                let label = dateStr;
                if (dateStr === today) label = '📅 Today';
                else if (dateStr === yesterday) label = '📅 Yesterday';
                html += `<div class="news-time-divider">${label}</div>`;
                lastDate = dateStr;
            }
            
            const tickers = h.affectedTickers || [];
            const sectors = h.affectedSectors || [];
            const isPSX = h.isPSX || (tickers.length > 0) || (sectors.length > 0);
            let cardClass = '';
            if (tickers.length > 0) cardClass = 'has-ticker';
            else if (sectors.length > 0) cardClass = 'has-sector';
            else if (isPSX) cardClass = 'psx-relevant';
            
            html += `<div class="news-ticker-item ${cardClass}">
                <div class="news-ticker-time">${timeStr}</div>
                <div class="news-ticker-content">
                    <div class="news-ticker-title">${h.title}</div>
                    <div class="news-ticker-meta">
                        <span class="news-ticker-source">${h.source}</span>
                        ${tickers.slice(0, 3).map(t => 
                            `<span class="news-ticker-badge news-ticker-ticker" onclick="event.stopPropagation();App.openStock('${t}')">$${t}</span>`
                        ).join('')}
                        ${sectors.slice(0, 2).map(s => 
                            `<span class="news-ticker-badge news-ticker-sector">${s}</span>`
                        ).join('')}
                        ${isPSX && tickers.length === 0 ? '<span class="news-ticker-psx">PSX</span>' : ''}
                    </div>
                </div>
            </div>`;
        });
        
        container.innerHTML = html;
    },

    renderStockNews(sym, data) {
        const c = document.getElementById('stockNewsContent');
        if (!c) return;
        
        if (!data) {
            c.innerHTML = '<div class="no-news">No news</div>';
            return;
        }
        
        const sc = {
            'STRONG_BUY': '#22c55e', 'BUY': '#4ade80', 'HOLD': '#f59e0b',
            'SELL': '#f87171', 'STRONG_SELL': '#ef4444'
        };
        
        let html = `<div class="news-signal-row" style="color:${sc[data.overallSignal] || '#94a3b8'}">
            ${State.newsSignal?.emoji || ''} ${(data.overallSignal || 'HOLD').replace('_', ' ')} • ${data.overallSentiment}
        </div>`;
        
        if (data.sector) {
            const imp = data.sectorImpact;
            html += `<div class="news-sector-row">
                📌 Sector: <strong>${data.sector}</strong>
                ${imp ? `<span class="news-sector-badge" style="background:${imp.impact === 'POSITIVE' ? 'var(--green)' : 'var(--red)'}22;color:${imp.impact === 'POSITIVE' ? 'var(--green)' : 'var(--red)'}">${imp.impact}</span>` : ''}
                ${imp?.reason ? `<div style="font-size:11px;color:var(--text2);margin-top:3px">${imp.reason}</div>` : ''}
            </div>`;
        }
        
        if (data.stockTrade) {
            const t = data.stockTrade;
            html += `<div class="news-rec">
                <span>🎯 <strong>${t.ticker}</strong> • ${t.reason || ''}</span>
                <span class="act ${t.action?.toLowerCase()}">${t.action}</span>
            </div>`;
        }
        
        if (data.summary) {
            html += `<div style="font-size:12px;margin-bottom:10px;line-height:1.5">${data.summary}</div>`;
        }
        
        if (data.relevantHeadlines?.length) {
            html += '<div style="font-size:12px;font-weight:600;margin-bottom:6px">📰 Related</div>';
            data.relevantHeadlines.forEach(n => {
                html += `<div class="news-headline-sm">${n.title}<span class="src">${n.source}</span></div>`;
            });
        }
        
        if (data.keyRisk) {
            html += `<div class="news-risk-box">⚠️ ${data.keyRisk}</div>`;
        }
        
        c.innerHTML = html;
    }
};