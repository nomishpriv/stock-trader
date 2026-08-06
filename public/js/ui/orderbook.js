// Order book handling
const UIOrderBook = {
    request(sym) {
        WS.send({ type: 'GET_ORDERBOOK', symbol: sym });
        if (State.orderBookTimer) clearInterval(State.orderBookTimer);
        
        State.orderBookTimer = setInterval(() => {
            if (State.currentModalSymbol && document.getElementById('stockModal').classList.contains('active')) {
                WS.send({ type: 'GET_ORDERBOOK', symbol: State.currentModalSymbol });
            } else {
                clearInterval(State.orderBookTimer);
                State.orderBookTimer = null;
            }
        }, CONFIG.ORDERBOOK_INTERVAL);
    },

    render(ob) {
        if (!ob) {
            document.getElementById('orderBookContent').innerHTML = '<div class="ob-loading"><p>No data</p></div>';
            return;
        }

        State.currentOrderBook = ob;
        const maxVol = Math.max(...[...ob.asks.map(a => a.volume), ...ob.bids.map(b => b.volume)], 1);

        const askRows = ob.asks.slice().reverse().map(a => `
            <div class="ob-row ask">
                <span>${a.price.toFixed(2)}</span>
                <span>${formatVol(a.volume)}</span>
                <span>${a.orders}</span>
                <div class="bar" style="width:${(a.volume / maxVol) * 100}%"></div>
            </div>
        `).join('');

        const bidRows = ob.bids.map(b => `
            <div class="ob-row bid">
                <span>${b.price.toFixed(2)}</span>
                <span>${formatVol(b.volume)}</span>
                <span>${b.orders}</span>
                <div class="bar" style="width:${(b.volume / maxVol) * 100}%"></div>
            </div>
        `).join('');

        const pc = {
            'STRONG_BUY': '#22c55e', 'BUY': '#4ade80',
            'STRONG_SELL': '#ef4444', 'SELL': '#f87171',
            'NEUTRAL': '#94a3b8'
        };

        // Trap detection HTML
        const trap = ob.trapDetection;
        let trapHTML = '';
        if (trap) {
            const confColor = trap.confidence > 70 ? 'var(--green)' : trap.confidence > 40 ? 'var(--orange)' : 'var(--red)';
            const bgColor = trap.confidence < 40 ? 'rgba(239,68,68,0.15)' : trap.confidence < 70 ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)';
            const borderColor = trap.confidence < 40 ? 'var(--red)' : trap.confidence < 70 ? 'var(--orange)' : 'var(--green)';

            trapHTML = `
                <div style="margin-top:12px;padding:12px;background:${bgColor};border-radius:10px;border:1px solid ${borderColor}">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                        <strong>🛡️ Order Book Validation</strong>
                        <span style="font-weight:700;font-size:14px;color:${confColor}">${trap.confidence}% Reliable</span>
                    </div>
                    ${trap.warnings?.length ? 
                        `<div style="font-size:11px;color:var(--text2);margin-bottom:6px">
                            ${trap.warnings.map(w => `<div style="padding:2px 0">${w}</div>`).join('')}
                        </div>` : 
                        '<div style="font-size:11px;color:var(--green);margin-bottom:6px">✅ No trap indicators detected</div>'
                    }
                    <div style="display:flex;gap:8px;font-size:10px;flex-wrap:wrap">
                        <span style="padding:3px 8px;border-radius:6px;background:${trap.isFakeWall ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.12)'};color:${trap.isFakeWall ? 'var(--red)' : 'var(--green)'}">
                            ${trap.isFakeWall ? '⚠️ Fake Wall' : '✅ No Fake Wall'}
                        </span>
                        <span style="padding:3px 8px;border-radius:6px;background:${trap.isSpoofing ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.12)'};color:${trap.isSpoofing ? 'var(--red)' : 'var(--green)'}">
                            ${trap.isSpoofing ? '⚠️ Spoofing' : '✅ No Spoofing'}
                        </span>
                        <span style="padding:3px 8px;border-radius:6px;background:${trap.isLowLiquidity ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.12)'};color:${trap.isLowLiquidity ? 'var(--red)' : 'var(--green)'}">
                            ${trap.isLowLiquidity ? '⚠️ Illiquid' : '✅ Liquid'}
                        </span>
                    </div>
                </div>`;
        }

        document.getElementById('orderBookContent').innerHTML = `
            <div class="ob-spread">Spread: ${ob.spread} (${ob.spreadPercent}%) | Bid: ${ob.bestBid} | Ask: ${ob.bestAsk}</div>
            <div class="orderbook-header"><span>Price</span><span>Volume</span><span>#Orders</span></div>
            <div class="orderbook-rows">
                <div class="ob-asks"><div class="ob-side-label" style="color:var(--red)">SELL</div>${askRows}</div>
                <div class="ob-bids"><div class="ob-side-label" style="color:var(--green)">BUY</div>${bidRows}</div>
            </div>
            <div class="ob-summary">
                <div class="ob-summary-item"><label>Bid Vol</label><span style="color:var(--green)">${formatVol(ob.totalBidVolume)}</span></div>
                <div class="ob-summary-item"><label>Ask Vol</label><span style="color:var(--red)">${formatVol(ob.totalAskVolume)}</span></div>
                <div class="ob-summary-item"><label>B/A Ratio</label><span>${ob.bidAskRatio}</span></div>
                <div class="ob-summary-item"><label>Imbalance</label><span style="color:${ob.imbalance > 0 ? 'var(--green)' : 'var(--red)'}">${ob.imbalance > 0 ? '+' : ''}${ob.imbalance}%</span></div>
            </div>
            <div style="text-align:center;margin-top:8px">
                <span class="pressure-badge" style="background:${pc[ob.pressure]}33;color:${pc[ob.pressure]}">${ob.pressure.replace(/_/g, ' ')} (Raw)</span>
                ${trap && trap.realSignal !== ob.pressure ? 
                    `<span class="pressure-badge" style="background:${pc[trap.realSignal] || '#94a3b8'}33;color:${pc[trap.realSignal] || '#94a3b8'};margin-left:6px">${(trap.realSignal || 'NEUTRAL').replace(/_/g, ' ')} (Validated)</span>` : ''}
            </div>
            ${ob.largeOrders?.length ? `
                <div class="large-orders">
                    <h4>🔔 Large Orders</h4>
                    ${ob.largeOrders.map(o => `
                        <div class="large-order ${o.type === 'BID' ? 'bid-type' : 'ask-type'}">
                            <span>${o.type === 'BID' ? '🟢 Buy' : '🔴 Sell'}</span>
                            <span>@ ${o.price.toFixed(2)}</span>
                            <span>${formatVol(o.volume)}</span>
                            <span class="impact-${o.impact.toLowerCase()}">${o.impact}</span>
                        </div>
                    `).join('')}
                </div>` : ''}
            ${trapHTML}
        `;
    }
};