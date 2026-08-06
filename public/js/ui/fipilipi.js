const UIFipiLipi = {
    lastMood: null,
    
    init() {
        // nothing heavy needed; render() finds elements dynamically
    },

    refresh() {
        if (typeof WS !== 'undefined' && WS.send) {
            WS.send({ type: 'GET_FIPILIPI' });
        }
    },

    render(data) {
        if (!data || !data.sectorAnalysis) {
            console.warn('UIFipiLipi: invalid data');
            return;
        }

        const { sectorAnalysis, flowMomentum, divergences } = data;
        const { sectors, totals, topGainingSectors, topLosingSectors, mainSummary } = sectorAnalysis;
        const { fipiTrend, localTrend, acceleration } = flowMomentum || {};
        const fipiNet = totals?.totalFipiNet || 0;
        const localNet = totals?.totalLocalNet || 0;

        // ── Mood Badge ──
        let mood = 'NEUTRAL', moodClass = 'neutral', moodEmoji = '➖';
        if (fipiNet > 0.5 && localNet >= 0) { mood = 'BULLISH'; moodClass = 'bullish'; moodEmoji = '🟢'; }
        else if (fipiNet > 0.5 && localNet < 0) { mood = 'VERY BULLISH'; moodClass = 'very-bullish'; moodEmoji = '🚀'; }
        else if (fipiNet < -0.5 && localNet <= 0) { mood = 'BEARISH'; moodClass = 'bearish'; moodEmoji = '🔴'; }
        else if (fipiNet < -0.5 && localNet > 0) { mood = 'DISTRIBUTION'; moodClass = 'distribution'; moodEmoji = '⚠️'; }

        const mb = document.getElementById('moodBadge');
        if (mb) { mb.textContent = `${moodEmoji} ${mood}`; mb.className = `mood-badge ${moodClass}`; }

        // ── Phase Indicator ──
        let phase = 'MARKUP';
        if (fipiNet < -0.3 && localNet < 0) phase = 'DISTRIBUTION';
        else if (fipiNet < -0.3 && localNet > 0) phase = 'MARKDOWN';
        else if (fipiNet > 0.3 && localNet < 0) phase = 'ACCUMULATION';
        
        document.querySelectorAll('.phase-box').forEach(b => b.classList.toggle('active', b.dataset.phase === phase));

        // ── Flow Bars ──
        const maxFlow = Math.max(Math.abs(fipiNet), Math.abs(localNet), 1);
        const fEl = document.getElementById('fipiNetValue');
        const fBar = document.getElementById('fipiNetBar');
        const lEl = document.getElementById('localNetValue');
        const lBar = document.getElementById('localNetBar');

        if (fEl) fEl.textContent = `${fipiNet >= 0 ? '+' : ''}$${fipiNet.toFixed(2)}M`;
        if (fBar) { fBar.style.width = `${Math.min((Math.abs(fipiNet)/maxFlow)*100,100)}%`; fBar.style.background = fipiNet >= 0 ? '#00c853' : '#ff5252'; }
        if (lEl) lEl.textContent = `${localNet >= 0 ? '+' : ''}$${localNet.toFixed(2)}M`;
        if (lBar) { lBar.style.width = `${Math.min((Math.abs(localNet)/maxFlow)*100,100)}%`; lBar.style.background = localNet >= 0 ? '#00c853' : '#ff5252'; }

        // ── Mood Shift Alert ──
        const sa = document.getElementById('moodShiftAlert');
        const sd = document.getElementById('shiftDetail');
        if (this.lastMood && this.lastMood !== mood) {
            if (sa) sa.style.display = 'flex';
            if (sd) sd.textContent = `${this.lastMood} → ${mood}`;
        } else if (sa) sa.style.display = 'none';
        this.lastMood = mood;

        // ── Divergences ──
        const ds = document.getElementById('divergencesSection');
        const dl = document.getElementById('divergencesList');
        if (divergences && divergences.length > 0) {
            if (ds) ds.style.display = 'block';
            if (dl) dl.innerHTML = divergences.map(d => `
                <div class="divergence-row ${d.type.toLowerCase()}">
                    <span>${d.type === 'BULLISH' ? '💎' : '⚠️'} <b>${d.sector}</b></span>
                    <span style="font-size:11px;opacity:.8">${d.message}</span>
                </div>`).join('');
        } else if (ds) ds.style.display = 'none';

        // ── Action Panel ──
        let action = 'HOLD — Wait for clearer directional bias.', conviction = 'Low', urgency = 'Normal';
        if (mood === 'VERY BULLISH') { action = 'ACCUMULATE — Foreign buying aggressively while locals sell. Follow smart money.'; conviction = 'High'; urgency = 'High'; }
        else if (mood === 'BULLISH') { action = 'BUY / HOLD — Broad-based buying. Trend-following favorable.'; conviction = 'Medium'; }
        else if (mood === 'DISTRIBUTION') { action = 'REDUCE / HEDGE — Foreigners dumping, locals trapped.'; conviction = 'High'; urgency = 'High'; }
        else if (mood === 'BEARISH') { action = 'STAY CAUTIOUS — Selling pressure across the board.'; conviction = 'Medium'; }
        if (acceleration > 0.5) urgency = 'Very High';
        if (acceleration < -0.5) urgency = 'Very High';

        const at = document.getElementById('actionText'), ac = document.getElementById('actionConviction'), au = document.getElementById('actionUrgency');
        if (at) at.textContent = action;
        if (ac) ac.textContent = conviction;
        if (au) au.textContent = urgency;

        // ── Sector Rotation ──
        const rs = document.getElementById('rotationStyle');
        if (rs) {
            rs.style.display = 'block';
            if (fipiNet > 0 && localNet > 0) rs.textContent = 'Broad-Based Rally';
            else if (fipiNet > 0 && localNet < 0) rs.textContent = 'Smart Money Leading';
            else if (fipiNet < 0 && localNet > 0) rs.textContent = 'Local Trap';
            else rs.textContent = 'Risk-Off';
        }
        const hot = document.getElementById('hotSectors');
        const cold = document.getElementById('coldSectors');
        if (hot) hot.innerHTML = (topGainingSectors||[]).slice(0,5).map(s => `<div class="rot-row"><span>${s.name}</span><span class="up">+$${s.netValueUSD.toFixed(2)}M</span></div>`).join('') || '<div class="empty">None</div>';
        if (cold) cold.innerHTML = (topLosingSectors||[]).slice(0,5).map(s => `<div class="rot-row"><span>${s.name}</span><span class="down">-$${Math.abs(s.netValueUSD).toFixed(2)}M</span></div>`).join('') || '<div class="empty">None</div>';

        // ── Investor Breakdown ──
        const fd = document.getElementById('fipiDetails');
        if (fd) {
            if (mainSummary?.details?.length) {
                fd.innerHTML = `<table class="mini-table"><thead><tr><th>Type</th><th>Buy</th><th>Sell</th><th>Net</th></tr></thead><tbody>` +
                    mainSummary.details.map(d => {
                        const net = (d.FLBuyValue||0)-(d.FLSellValue||0);
                        return `<tr><td>${d.FLType||d.FLInvestorType||'-'}</td><td>${(d.FLBuyValue||0).toFixed(2)}</td><td>${(d.FLSellValue||0).toFixed(2)}</td><td class="${net>=0?'up':'down'}">${net>=0?'+':''}${net.toFixed(2)}</td></tr>`;
                    }).join('') + '</tbody></table>';
            } else {
                fd.innerHTML = '<div class="empty">No breakdown available</div>';
            }
        }

        // ── Sector-wise Flow ──
        const fs = document.getElementById('fipiSectors');
        if (fs) {
            if (sectors?.length) {
                fs.innerHTML = `<table class="mini-table"><thead><tr><th>Sector</th><th>FIPI</th><th>Local</th><th>Total</th></tr></thead><tbody>` +
                    sectors.map(s => `<tr><td>${s.name}</td><td class="${s.fipiNet>=0?'up':'down'}">${s.fipiNet>=0?'+':''}$${s.fipiNet.toFixed(2)}M</td><td class="${s.localNet>=0?'up':'down'}">${s.localNet>=0?'+':''}$${s.localNet.toFixed(2)}M</td><td class="${s.netValueUSD>=0?'up':'down'}"><b>${s.netValueUSD>=0?'+':''}$${s.netValueUSD.toFixed(2)}M</b></td></tr>`).join('') + '</tbody></table>';
            } else fs.innerHTML = '<div class="empty">No sector data</div>';
        }

        // ── Market Bar Mood (optional sync) ──
        const mm = document.getElementById('marketMood');
        if (mm) { mm.textContent = `${moodEmoji} ${mood}`; mm.style.background = fipiNet>0 ? 'rgba(0,200,83,0.15)' : fipiNet<0 ? 'rgba(255,82,82,0.15)' : 'var(--bg3)'; mm.style.color = fipiNet>0 ? 'var(--green)' : fipiNet<0 ? 'var(--red)' : 'var(--text2)'; }
    }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => UIFipiLipi.init());
else UIFipiLipi.init();