/**
 * Sectors UI — Enhanced with Wyckoff Phases, Mood & Rotation
 * Compatible with both old and new message formats
 */

const UISectors = {
    sectors: [],
    mood: null,
    rotation: null,
    signals: null,
    filter: 'all',

    init() {
        document.querySelectorAll('#sectorFilters .filter').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('#sectorFilters .filter').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.filter = e.target.dataset.sectorFilter;
                this.renderList();
            });
        });
    },

    // Called by MessageHandler for SECTORS_DATA
    render(data) {
        if (!data) return;

        // Handle both old format ({ sectors: [...] }) and new format ({ sectors, institutionalMood, ... })
        if (Array.isArray(data)) {
            this.sectors = data;
        } else if (data.sectors) {
            this.sectors = data.sectors;
            this.mood = data.institutionalMood || null;
            this.rotation = data.sectorRotation || null;
            this.signals = data.signals || null;
            this.renderMoodBar();
        } else {
            this.sectors = data;
        }

        this.renderList();
    },

    // Called by MessageHandler for SECTOR_STOCKS (old API)
    renderSectorStocks(sectorName, stocks) {
        const list = document.getElementById('sectorsList');
        if (!list) return;

        if (!stocks || stocks.length === 0) {
            list.innerHTML = `<div class="empty-state">No stocks found for ${sectorName}</div>`;
            return;
        }

        let html = `<div style="padding:10px;background:var(--bg2);border-radius:10px;margin-bottom:10px;font-size:14px;font-weight:700">
            📂 ${sectorName} — ${stocks.length} stocks
            <button onclick="UISectors.renderList()" style="float:right;font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text);cursor:pointer">← Back</button>
        </div>`;

        html += stocks.map(s => this.renderStockMiniCard(s)).join('');
        list.innerHTML = html;
    },

    renderStockMiniCard(stock) {
        const color = stock.changePercent >= 0 ? 'var(--green)' : 'var(--red)';
        const sign = stock.changePercent >= 0 ? '+' : '';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;margin-bottom:6px;border-radius:10px;background:var(--bg2);border:1px solid var(--border);cursor:pointer" onclick="App.openModal('${stock.symbol}')">
            <div>
                <div style="font-size:13px;font-weight:700">${stock.symbol}</div>
                <div style="font-size:11px;color:var(--text2)">${stock.name || ''}</div>
            </div>
            <div style="text-align:right">
                <div style="font-size:14px;font-weight:700">${stock.price.toFixed(2)}</div>
                <div style="font-size:11px;color:${color}">${sign}${stock.changePercent.toFixed(2)}%</div>
            </div>
        </div>`;
    },

    renderMoodBar() {
        const bar = document.getElementById('sectorsMoodBar');
        if (!bar) return;

        // Hide if no mood data
        if (!this.mood) {
            bar.style.display = 'none';
            return;
        }

        const m = this.mood;

        // Safety: ensure all required properties exist
        const moodText = (m.mood || 'NEUTRAL').replace(/_/g, ' ');
        const phase = m.phase || 'NEUTRAL';
        const signal = m.signal || 'HOLD';
        const actionText = (m.action || 'No action data').substring(0, 60);

        const emoji = this.getMoodEmoji(m.mood || 'NEUTRAL');

        bar.style.display = 'block';
        bar.innerHTML = `${emoji} <strong>${moodText}</strong> — ${phase} — Signal: ${signal} — ${actionText}`;

        // Color based on mood
        const moodRaw = m.mood || 'NEUTRAL';
        if (moodRaw.includes('BUY')) {
            bar.style.background = 'color-mix(in srgb, var(--green) 12%, transparent)';
            bar.style.color = 'var(--green)';
            bar.style.border = '1px solid color-mix(in srgb, var(--green) 25%, transparent)';
        } else if (moodRaw.includes('SELL')) {
            bar.style.background = 'color-mix(in srgb, var(--red) 12%, transparent)';
            bar.style.color = 'var(--red)';
            bar.style.border = '1px solid color-mix(in srgb, var(--red) 25%, transparent)';
        } else {
            bar.style.background = 'var(--bg3)';
            bar.style.color = 'var(--text2)';
            bar.style.border = '1px solid var(--border)';
        }
    },

    renderList() {
        const list = document.getElementById('sectorsList');
        if (!list) return;

        let filtered = this.sectors || [];

        switch(this.filter) {
            case 'strongbuy':
                filtered = filtered.filter(s => s.recommendation === 'STRONG_BUY');
                break;
            case 'buy':
                filtered = filtered.filter(s => s.recommendation === 'BUY' || s.recommendation === 'ACCUMULATE');
                break;
            case 'gaining':
                filtered = filtered.filter(s => (s.avgChange || 0) > 0);
                break;
            case 'losing':
                filtered = filtered.filter(s => (s.avgChange || 0) < 0);
                break;
            case 'fipi':
                filtered = filtered.filter(s => Math.abs(s.fipiNet || 0) > 0.1);
                break;
            case 'lowrisk':
                filtered = filtered.filter(s => s.riskLevel === 'LOW');
                break;
            case 'accumulation':
                filtered = filtered.filter(s => s.mood === 'ACCUMULATION');
                break;
            case 'markup':
                filtered = filtered.filter(s => s.mood === 'MARKUP');
                break;
            case 'distribution':
                filtered = filtered.filter(s => s.mood === 'DISTRIBUTION');
                break;
        }

        if (filtered.length === 0) {
            list.innerHTML = '<div class="empty-state">No sectors match this filter</div>';
            return;
        }

        list.innerHTML = filtered.map(s => this.renderSectorCard(s)).join('');
    },

    renderSectorCard(s) {
        const changeColor = (s.avgChange || 0) >= 0 ? 'var(--green)' : 'var(--red)';
        const changeSign = (s.avgChange || 0) >= 0 ? '+' : '';

        let phaseBadge = '';
        if (s.mood && s.mood !== 'NEUTRAL') {
            const phaseEmoji = { 'ACCUMULATION': '💎', 'MARKUP': '📈', 'DISTRIBUTION': '⚠️', 'MARKDOWN': '🔻' }[s.mood] || '';
            phaseBadge = `<span class="phase-badge ${s.mood.toLowerCase()}">${phaseEmoji} ${s.mood}</span>`;
        }

        let rotationInd = '';
        if (s.rotationSignal === 'ROTATE_IN') {
            rotationInd = '<span style="font-size:10px;color:var(--green);margin-left:4px">🔄 IN</span>';
        } else if (s.rotationSignal === 'ROTATE_OUT') {
            rotationInd = '<span style="font-size:10px;color:var(--red);margin-left:4px">🔄 OUT</span>';
        }

        const fipiColor = (s.fipiNet || 0) >= 0 ? 'var(--green)' : 'var(--red)';
        const fipiSign = (s.fipiNet || 0) >= 0 ? '+' : '';

        const topStocks = (s.topStocks || []).slice(0, 3).map(st => {
            const stColor = (st.change || 0) >= 0 ? 'var(--green)' : 'var(--red)';
            const stSign = (st.change || 0) >= 0 ? '+' : '';
            return `<span style="font-size:10px;color:${stColor}">${st.symbol} ${stSign}${(st.change || 0).toFixed(1)}%</span>`;
        }).join(' · ');

        let setupBadge = '';
        if (s.bestSetup) {
            const setupColor = s.bestSetup.action === 'STRONG_ENTRY' || s.bestSetup.action === 'ENTRY' ? 'var(--green)' : 
                              s.bestSetup.action === 'EXIT' ? 'var(--red)' : 'var(--text2)';
            setupBadge = `<div style="margin-top:6px;padding:4px 8px;border-radius:6px;background:color-mix(in srgb, ${setupColor} 8%, transparent);border:1px solid color-mix(in srgb, ${setupColor} 15%, transparent);font-size:11px;color:${setupColor}">
                🎯 ${s.bestSetup.action.replace(/_/g, ' ')}: ${s.bestSetup.symbol} @ ${s.bestSetup.price} (${s.bestSetup.conviction}% conviction)
            </div>`;
        }

        return `<div class="sector-card" style="padding:12px;margin-bottom:8px;border-radius:12px;background:var(--bg2);border:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
                <div>
                    <div style="font-size:14px;font-weight:700;color:var(--text)">${s.name}${phaseBadge}${rotationInd}</div>
                    <div style="font-size:11px;color:var(--text2);margin-top:2px">${s.stockCount || 0} stocks · Avg RSI ${(s.avgRSI || 0).toFixed(1)}</div>
                </div>
                <div style="text-align:right">
                    <div style="font-size:16px;font-weight:700;color:${changeColor}">${changeSign}${(s.avgChange || 0).toFixed(2)}%</div>
                    <div style="font-size:10px;color:var(--text2)">${s.gainers || 0}↗ ${s.losers || 0}↘</div>
                </div>
            </div>

            <div style="display:flex;gap:12px;margin-bottom:6px;font-size:11px">
                <span style="color:${fipiColor};font-weight:600">🌍 FIPI: ${fipiSign}$${(s.fipiNet || 0).toFixed(2)}M</span>
                <span style="color:var(--text2)">🏠 Local: ${(s.localNet || 0) >= 0 ? '+' : ''}$${(s.localNet || 0).toFixed(2)}M</span>
                <span style="color:var(--text2)">Score: ${s.compositeScore || 0}</span>
            </div>

            <div style="font-size:10px;color:var(--text2);line-height:1.5">${s.narrative || ''}</div>

            ${topStocks ? `<div style="margin-top:6px;font-size:10px;color:var(--text2)">Top: ${topStocks}</div>` : ''}
            ${setupBadge}

            ${s.moodNarrative ? `<div style="margin-top:8px;padding:8px;border-radius:8px;background:var(--bg3);font-size:11px;color:var(--text2);line-height:1.5;white-space:pre-line">${s.moodNarrative}</div>` : ''}
        </div>`;
    },

    getMoodEmoji(mood) {
        const map = {
            'HEAVY_BUYING': '🚀🚀', 'BUYING': '🚀', 'LIGHT_BUYING': '👍',
            'NEUTRAL': '➖', 'LIGHT_SELLING': '⚠️', 'SELLING': '🔻', 'HEAVY_SELLING': '🔻🔻'
        };
        return map[mood] || '➖';
    }
};

// Auto-init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => UISectors.init());
} else {
    UISectors.init();
}