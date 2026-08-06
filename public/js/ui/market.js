// Market tab rendering
const UIMarket = {
    render() {
        if (!State.stocks.length) {
            document.getElementById('marketList').innerHTML = '<div class="empty-state">Loading...</div>';
            return;
        }

        let filtered = [...State.stocks];

        // Apply sector filter
        if (State.currentFilter === 'sector' && State.sectorFilterSymbols?.length) {
            filtered = filtered.filter(s => State.sectorFilterSymbols.includes(s.symbol));
        }
        // Standard filters
        else if (State.currentFilter === 'gainers') {
            filtered = filtered.filter(s => s.changePercent > 0);
        } else if (State.currentFilter === 'losers') {
            filtered = filtered.filter(s => s.changePercent < 0);
        } else if (State.currentFilter === 'volume') {
            filtered = filtered.filter(s => s.volume > 100000);
        }

        filtered.sort((a, b) => b.volume - a.volume);
        filtered = filtered.slice(0, CONFIG.MAX_MARKET_STOCKS);

        const listEl = document.getElementById('marketList');
        if (!filtered.length) {
            listEl.innerHTML = '<div class="empty-state">No stocks found for this filter</div>';
            return;
        }

        listEl.innerHTML = filtered.map(s => stockCard(s)).join('');
        this.updateSectorFilterBadge();
    },

    updateSectorFilterBadge() {
        const filterBar = document.querySelector('#marketTab .filter-bar');
        if (!filterBar) return;

        // Remove old sector badge
        const oldBadge = filterBar.querySelector('[data-filter="sector"]');
        if (oldBadge) oldBadge.remove();

        // Add sector badge if sector filter is active
        if (State.currentFilter === 'sector' && State.currentSectorName) {
            const sectorBtn = document.createElement('button');
            sectorBtn.className = 'filter active';
            sectorBtn.dataset.filter = 'sector';
            sectorBtn.textContent = '🏭 ' + State.currentSectorName;
            sectorBtn.onclick = () => {
                State.currentFilter = 'all';
                document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
                const allBtn = document.querySelector('[data-filter="all"]');
                if (allBtn) allBtn.classList.add('active');
                State.sectorFilterSymbols = null;
                State.currentSectorName = null;
                this.updateSectorFilterBadge();
                this.render();
            };
            filterBar.appendChild(sectorBtn);
        }
    }
};