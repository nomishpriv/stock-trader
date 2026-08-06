// Common UI functions
const UI = {
    updateStatus() {
        const d = document.getElementById('statusDot');
        const t = document.getElementById('statusText');
        if (State.connected && State.loggedIn) {
            d.style.background = '#22c55e';
            t.textContent = 'Live';
        } else if (State.connected) {
            d.style.background = '#f59e0b';
            t.textContent = 'Connected';
        } else {
            d.style.background = '#ef4444';
            t.textContent = 'Offline';
        }
    },

    showLogin(auto = true, error = '') {
        document.getElementById('loginScreen').classList.add('active');
        document.getElementById('mainScreen').classList.remove('active');
        
        const st = document.getElementById('loginStatus');
        const btn = document.getElementById('loginBtn');
        const err = document.getElementById('loginError');
        
        if (error) {
            st.innerHTML = '<span>❌ Failed</span>';
            err.textContent = error;
            btn.style.display = 'block';
        } else if (auto) {
            st.innerHTML = '<div class="spinner"></div><span>Connecting...</span>';
            btn.style.display = 'none';
        } else {
            st.innerHTML = '<span>🔐 Login required</span>';
            btn.style.display = 'block';
        }
    },

    showMain() {
        document.getElementById('loginScreen').classList.remove('active');
        document.getElementById('mainScreen').classList.add('active');
        App.renderAll();
    },

    updateMarketBar() {
        if (State.kse100) {
            document.getElementById('kseValue').textContent = `KSE100: ${State.kse100.value?.toLocaleString() || '---'}`;
            const ch = State.kse100.changePercent || 0;
            const ce = document.getElementById('kseChange');
            ce.textContent = `${ch >= 0 ? '+' : ''}${ch}%`;
            ce.style.color = ch >= 0 ? 'var(--green)' : 'var(--red)';
            document.getElementById('marketVol').textContent = `Vol: ${formatVol(State.kse100.volume)}`;
        }
    },

    updateVisibleCards(nm) {
        document.querySelectorAll('.stock-card').forEach(c => {
            const s = nm.get(c.dataset.symbol);
            if (!s) return;
            
            const pe = c.querySelector('.stock-price');
            const ce = c.querySelector('.stock-change');
            const ve = c.querySelector('.stock-stats span:first-child');
            const re = c.querySelector('.stock-stats span:last-child');
            
            if (pe) pe.textContent = s.price?.toFixed(2) || '0.00';
            if (ce) {
                const ch = s.changePercent || 0;
                ce.textContent = `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`;
                ce.className = 'stock-change ' + (ch >= 0 ? 'up' : 'down');
            }
            if (ve) ve.textContent = 'Vol: ' + formatVol(s.volume);
            if (re) re.textContent = 'RSI: ' + (s.rsi?.toFixed(1) || '-');
        });
    },

    flashPrice(sym, op, np) {
        const c = document.querySelector(`.stock-card[data-symbol="${sym}"]`);
        if (!c) return;
        const p = c.querySelector('.stock-price');
        if (p) {
            p.style.color = np > op ? '#22c55e' : np < op ? '#ef4444' : '';
            p.style.transition = 'color 0.3s';
            setTimeout(() => p.style.color = '', 1000);
            p.textContent = np?.toFixed(2) || '0.00';
        }
        if (State.currentModalSymbol === sym) {
            UIModal.updatePrice(np, op);
            UIModal.updateFromCache(sym);
        }
    }
};