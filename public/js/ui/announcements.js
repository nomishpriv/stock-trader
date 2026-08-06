// Announcements tab
const UIAnnouncements = {
    render(data) {
        if (!data) return;
        
        // Store globally
        State.allAnnouncements = data.announcements || [];
        State.announcementTabs = data.tabs || [];
        State.announcementsByType = data.byType || {};
        
        // Build summary bar
        const sum = document.getElementById('annSummary');
        if (sum) {
            let badgesHTML = `<span class="ann-type-badge active" data-ann-filter="all" onclick="UIAnnouncements.filter('all')" style="cursor:pointer;background:var(--blue);color:white;font-weight:600">
                📢 All (${data.total || State.allAnnouncements.length})
            </span>`;
            
            if (State.announcementTabs.length > 0) {
                badgesHTML += State.announcementTabs.map(t => 
                    `<span class="ann-type-badge" data-ann-filter="${t.type}" onclick="UIAnnouncements.filter('${t.type}')" style="cursor:pointer;border-left:3px solid ${t.color || '#94a3b8'}">
                        ${t.icon || '📢'} ${t.label || t.type} (${t.count})
                    </span>`
                ).join('');
            } else {
                const typeCounts = data.typeCounts || {};
                const typeInfo = {
                    'FR': { icon: '📊', label: 'Results', color: '#3b82f6' },
                    'DIV': { icon: '💰', label: 'Dividend', color: '#22c55e' },
                    'BON': { icon: '🎁', label: 'Bonus', color: '#8b5cf6' },
                    'BM': { icon: '📅', label: 'Board', color: '#6366f1' },
                    'MI': { icon: '📋', label: 'Material', color: '#14b8a6' },
                    'U': { icon: '📢', label: 'Update', color: '#9ca3af' },
                    'E': { icon: '📡', label: 'Notice', color: '#6b7280' },
                    'AGM': { icon: '🏛️', label: 'AGM', color: '#ec4899' },
                    'RGT': { icon: '📜', label: 'Rights', color: '#f59e0b' },
                    'SPL': { icon: '✂️', label: 'Split', color: '#06b6d4' }
                };
                
                const counts = Object.keys(typeCounts).length > 0 ? typeCounts : 
                    (State.announcementsByType ? 
                        Object.fromEntries(Object.entries(State.announcementsByType).map(([k, v]) => [k, v.length])) : {});
                
                Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
                    const info = typeInfo[type] || { icon: '📢', label: type, color: '#94a3b8' };
                    badgesHTML += `<span class="ann-type-badge" data-ann-filter="${type}" onclick="UIAnnouncements.filter('${type}')" style="cursor:pointer;border-left:3px solid ${info.color}">
                        ${info.icon} ${info.label} (${count})
                    </span>`;
                });
            }
            
            sum.innerHTML = badgesHTML;
        }
        
        State.currentAnnFilter = 'all';
        this.display(State.allAnnouncements);
    },

    filter(type) {
        State.currentAnnFilter = type;
        
        document.querySelectorAll('.ann-type-badge').forEach(badge => {
            badge.style.background = '';
            badge.style.color = '';
            badge.style.fontWeight = '';
        });
        
        const activeBadge = document.querySelector(`[data-ann-filter="${type}"]`);
        if (activeBadge) {
            activeBadge.style.background = 'var(--blue)';
            activeBadge.style.color = 'white';
            activeBadge.style.fontWeight = '600';
        }
        
        let filtered;
        if (type === 'all') {
            filtered = State.allAnnouncements;
        } else {
            filtered = State.announcementsByType?.[type] || 
                       State.allAnnouncements.filter(a => a.type === type);
        }
        
        this.display(filtered);
    },

    display(announcements) {
        const list = document.getElementById('annHighImpact');
        if (!list) return;
        
        if (!announcements || !announcements.length) {
            list.innerHTML = '<div class="empty-state">No announcements found for this filter</div>';
            return;
        }
        
        const impactColors = {
            'STRONG_POSITIVE': '#22c55e', 'POSITIVE': '#4ade80',
            'NEUTRAL': '#94a3b8', 'NEGATIVE': '#f87171', 'STRONG_NEGATIVE': '#ef4444'
        };
        
        list.innerHTML = announcements.map(a => {
            const color = a.color || '#94a3b8';
            const impactColor = impactColors[a.impact] || '#94a3b8';
            
            let dateStr = '';
            if (a.date) {
                try {
                    dateStr = new Date(a.date).toLocaleDateString('en-PK', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    });
                } catch (e) { dateStr = a.date; }
            }
            
            return `<div class="ann-card" style="border-left-color:${color}" onclick="App.openStock('${a.symbol}')">
                <div class="ann-sym">
                    <span style="font-weight:700">${a.symbol}</span>
                    <span style="margin-left:8px;font-size:14px">${a.typeIcon || ''}</span>
                    <span style="font-size:10px;color:${a.typeColor || '#94a3b8'};margin-left:4px">${a.typeShort || ''}</span>
                </div>
                <div class="ann-title">${a.title}</div>
                <div class="ann-meta">
                    <span class="ann-score-badge" style="background:${color}22;color:${color}">${a.signal || ''}</span>
                    <span style="color:${impactColor};font-size:10px;font-weight:600">${a.impact || 'NEUTRAL'}</span>
                    ${a.quarter ? `<span style="color:var(--text2);font-size:10px">📅 ${a.quarter}</span>` : ''}
                    ${dateStr ? `<span style="color:var(--text2);font-size:10px">${dateStr}</span>` : ''}
                </div>
                ${a.details ? `
                    <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;font-size:10px">
                        ${a.details.eps !== undefined ? 
                            `<span style="background:var(--bg3);padding:3px 6px;border-radius:4px">EPS: <b>${a.details.eps}</b></span>` : ''}
                        ${a.details.dividend > 0 ? 
                            `<span style="background:var(--bg3);padding:3px 6px;border-radius:4px;color:var(--green)">💰 Div: <b>${a.details.dividend}%</b></span>` : ''}
                        ${a.details.bonus > 0 ? 
                            `<span style="background:var(--bg3);padding:3px 6px;border-radius:4px;color:var(--purple)">🎁 Bonus: <b>${a.details.bonus}%</b></span>` : ''}
                        ${a.details.rightIssue > 0 ? 
                            `<span style="background:var(--bg3);padding:3px 6px;border-radius:4px">📜 Rights: <b>${a.details.rightIssue}%</b></span>` : ''}
                    </div>
                ` : ''}
            </div>`;
        }).join('');
    },

    renderStockAnnouncement(data) {
        const c = document.getElementById('stockAnnContent');
        if (!c) return;
        
        if (!data) {
            c.innerHTML = '<div class="no-news">No announcements for this stock</div>';
            return;
        }
        
        const color = data.color || '#94a3b8';
        
        c.innerHTML = `<div class="ann-card" style="border-left-color:${color}">
            <div class="ann-sym">
                <span style="font-size:16px">${data.typeIcon || ''}</span>
                <span style="font-weight:700;margin-left:6px">${data.typeLabel || 'Announcement'}</span>
            </div>
            <div class="ann-title" style="font-size:14px;margin:8px 0">${data.title}</div>
            <div class="ann-meta">
                <span class="ann-score-badge" style="background:${color}22;color:${color};font-size:13px">${data.signal || 'N/A'}</span>
                <span style="color:var(--text2);font-size:12px">Score: ${data.score > 0 ? '+' : ''}${data.score || 0}</span>
                <span style="color:var(--text2);font-size:12px">Impact: ${data.impact || 'NEUTRAL'}</span>
                ${data.quarter ? `<span style="color:var(--text2);font-size:12px">📅 ${data.quarter}</span>` : ''}
            </div>
            ${data.date ? `<div style="font-size:10px;color:var(--text2);margin-top:4px">${new Date(data.date).toLocaleString('en-PK')}</div>` : ''}
            ${data.details ? `
                <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
                    ${data.details.eps !== undefined ? `
                        <div style="background:var(--bg3);padding:8px;border-radius:8px">
                            <span style="color:var(--text2)">EPS</span><br>
                            <b style="font-size:16px">${data.details.eps}</b>
                        </div>` : ''}
                    ${data.details.dividend > 0 ? `
                        <div style="background:var(--bg3);padding:8px;border-radius:8px;border:1px solid var(--green)">
                            <span style="color:var(--green)">💰 Dividend</span><br>
                            <b style="font-size:16px;color:var(--green)">${data.details.dividend}%</b>
                        </div>` : ''}
                    ${data.details.bonus > 0 ? `
                        <div style="background:var(--bg3);padding:8px;border-radius:8px;border:1px solid var(--purple)">
                            <span style="color:var(--purple)">🎁 Bonus</span><br>
                            <b style="font-size:16px;color:var(--purple)">${data.details.bonus}%</b>
                        </div>` : ''}
                </div>
            ` : ''}
            ${data.meetingTime ? `
                <div style="margin-top:8px;padding:8px;background:var(--bg3);border-radius:6px;font-size:11px">
                    🕐 Meeting: <b>${data.meetingTime}</b>
                </div>` : ''}
        </div>`;
    }
};