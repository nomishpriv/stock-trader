'use strict';

const axios = require('axios');
const { api } = require('./authService');

const BASE = 'https://app.stockintel.com/api';

// ─── TYPE DEFINITIONS ────────────────────────────────────────────────────────
const TYPE_MAP = {
  'FR':  { label: 'Financial Result', icon: '📊', color: '#3b82f6', short: 'Results' },
  'DIV': { label: 'Dividend',         icon: '💰', color: '#22c55e', short: 'Dividend' },
  'BON': { label: 'Bonus Issue',      icon: '🎁', color: '#8b5cf6', short: 'Bonus' },
  'RGT': { label: 'Rights Issue',     icon: '📜', color: '#f59e0b', short: 'Rights' },
  'SPL': { label: 'Stock Split',      icon: '✂️',  color: '#06b6d4', short: 'Split' },
  'BM':  { label: 'Board Meeting',    icon: '📅', color: '#6366f1', short: 'Board' },
  'AGM': { label: 'AGM / EGM',        icon: '🏛️', color: '#ec4899', short: 'AGM' },
  'MI':  { label: 'Material Info',    icon: '📋', color: '#14b8a6', short: 'Material' },
  'U':   { label: 'Update',           icon: '📢', color: '#9ca3af', short: 'Update' },
  'E':   { label: 'Market Notice',    icon: '📡', color: '#6b7280', short: 'Notice' },
};

// ─── KEYWORDS ────────────────────────────────────────────────────────────────
const POSITIVE_KW = ['profit', 'growth', 'expansion', 'acquisition', 'contract', 'order', 'export',
  'capacity', 'upgrade', 'approval', 'license', 'launch', 'production', 'investment', 'funding',
  'partnership', 'mou', 'agreement', 'signed', 'dividend', 'bonus', 'payout', 'record', 'highest',
  'turnaround', 'recovery', 'surge', 'jump', 'rise', 'increase', 'positive', 'strong'];

const NEGATIVE_KW = ['loss', 'fire', 'accident', 'shutdown', 'closure', 'suspension', 'delay',
  'cancel', 'default', 'penalty', 'fine', 'litigation', 'lawsuit', 'dispute', 'damage', 'fraud',
  'investigation', 'bankruptcy', 'insolvency', 'layoff', 'withdraw', 'recall', 'non-compliance',
  'violation', 'sanction', 'delisted', 'suspended', 'halt', 'liquidation', 'winding up',
  'corruption', 'decline', 'drop', 'fall', 'negative', 'weak', 'dismal'];

// ─── CACHE ────────────────────────────────────────────────────────────────────
let cache = { data: null, ts: 0 };
const CACHE_TTL = 300000; // 5 minutes

// ─── TYPE DETECTION ──────────────────────────────────────────────────────────
function detectType(item) {
  const title = (item.title || '').toLowerCase();
  const code = (item.type || '').toUpperCase();

  // Check title first for better accuracy
  if (title.includes('material information') || title.includes('material / price sensitive')) return 'MI';
  if (title.includes('financial result') || title.includes('financial results') || 
      title.includes('quarterly report') || title.includes('annual report') ||
      title.includes('quarterly accounts') || title.includes('annual accounts')) return 'FR';
  if (title.includes('dividend') || title.includes('cash dividend') || 
      title.includes('interim dividend') || title.includes('final dividend')) return 'DIV';
  if (title.includes('bonus') || title.includes('bonus shares') || 
      title.includes('bonus issue')) return 'BON';
  if (title.includes('rights issue') || title.includes('right issue') || 
      title.includes('right shares')) return 'RGT';
  if (title.includes('stock split') || title.includes('share split') || 
      title.includes('sub-division')) return 'SPL';
  if (title.includes('board meeting') || title.includes('meeting of board') || 
      title.includes('board of directors meeting')) return 'BM';
  if (title.includes('agm') || title.includes('egm') || 
      title.includes('annual general') || title.includes('extraordinary general')) return 'AGM';
  if (title.includes('corporate briefing') || title.includes('analyst briefing')) return 'E';

  // Fallback to API type code
  if (TYPE_MAP[code]) return code;
  
  // Default to Update for general announcements
  return 'U';
}

// ─── ANALYZERS ───────────────────────────────────────────────────────────────
function analyze(item) {
  const type = detectType(item);
  const meta = TYPE_MAP[type] || TYPE_MAP['U'];
  const title = item.title || '';
  const lower = title.toLowerCase();

  let score = 0, impact = 'NEUTRAL', signal = meta.label;

  // Score from results data
  const r = item.results || {};
  if (r.eps !== undefined) {
    const eps = +r.eps || 0, prev = +r.eps_sply || 0;
    if (prev && eps > prev * 1.5) { score += 8; impact = 'STRONG_POSITIVE'; signal = `🔥 EPS +${((eps/prev-1)*100).toFixed(0)}%`; }
    else if (prev && eps > prev * 1.2) { score += 5; impact = 'POSITIVE'; signal = `📈 EPS +${((eps/prev-1)*100).toFixed(0)}%`; }
    else if (prev && eps > prev) { score += 2; impact = 'SLIGHTLY_POSITIVE'; signal = '✅ EPS improved'; }
    else if (eps > 0 && !prev) { score += 3; impact = 'POSITIVE'; signal = '💰 Profitable'; }
    else if (eps < 0 && prev > 0) { score -= 5; impact = 'NEGATIVE'; signal = '📉 Loss reported'; }
    else if (eps < 0) { score -= 3; impact = 'NEGATIVE'; signal = '🔴 Loss'; }
  }

  // Score from payouts
  const p = item.payouts || {};
  if (p.dividend > 0) { 
    score += Math.min(6, p.dividend / 5); 
    impact = 'POSITIVE'; 
    signal = `💰 Div ${p.dividend}%`; 
  }
  if (p.bonus > 0) { 
    score += Math.min(5, p.bonus / 10); 
    impact = 'POSITIVE'; 
    signal += ` + Bonus ${p.bonus}%`; 
  }
  if (p.right_issue > 0 && p.right_price > 0) { 
    score -= 2; 
    impact = 'SLIGHTLY_NEGATIVE'; 
    signal = `📜 Rights ${p.right_issue} @ ${p.right_price}`; 
  }

  // Score from keywords
  let posHits = 0, negHits = 0;
  POSITIVE_KW.forEach(kw => { if (lower.includes(kw)) posHits++; });
  NEGATIVE_KW.forEach(kw => { if (lower.includes(kw)) negHits++; });
  score += posHits * 2;
  score -= negHits * 3;

  // Base score for announcement types
  if (type === 'FR' && score === 0) score = 1; // Financial results are important
  if (type === 'MI') score += 1; // Material info is important

  // Final impact
  score = Math.max(-10, Math.min(10, score));
  if (score >= 7) impact = 'STRONG_POSITIVE';
  else if (score >= 4) impact = 'POSITIVE';
  else if (score > 0) impact = 'SLIGHTLY_POSITIVE';
  else if (score === 0) impact = 'NEUTRAL';
  else if (score > -4) impact = 'SLIGHTLY_NEGATIVE';
  else if (score > -7) impact = 'NEGATIVE';
  else impact = 'STRONG_NEGATIVE';

  const color = score >= 5 ? '#22c55e' : score >= 2 ? '#84cc16' : 
                score <= -5 ? '#ef4444' : score <= -2 ? '#f97316' : '#f59e0b';

  return {
    id: item.id,
    symbol: item.symbol,
    title,
    type,
    typeIcon: meta.icon,
    typeLabel: meta.label,
    typeShort: meta.short,
    typeColor: meta.color,
    score,
    impact,
    signal,
    color,
    date: item.date,
    quarter: item.quarter || '',
    meetingTime: item.meeting?.time || '',
    pdf: item.pdf || null,
    details: {
      eps: r.eps,
      epsPrev: r.eps_sply,
      sales: r.sales,
      dividend: p.dividend || 0,
      bonus: p.bonus || 0,
      rightIssue: p.right_issue || 0,
      rightPrice: p.right_price || 0,
    }
  };
}

// ─── FETCH ───────────────────────────────────────────────────────────────────
async function fetchAnnouncements(dateOverride) {
  const target = dateOverride || new Date().toISOString().split('T')[0];
  try {
    const { data } = await api.get('/data/notices', {
      params: { from: target, to: target },
      timeout: 10000
    });
    console.log(`📢 Fetched ${data?.data?.length || 0} announcements for ${target}`);
    return data?.data || [];
  } catch (e) {
    console.error('❌ Announcements fetch failed:', e.message);
    return [];
  }
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
async function getAnnouncements({ date, forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && !date && cache.data && (now - cache.ts) < CACHE_TTL) {
    console.log('📢 Using cached announcements');
    return cache.data;
  }

  const raw = await fetchAnnouncements(date);
  
  // Analyze all items and ensure all types are represented
  const analyzed = raw.map(analyze).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  // Group by type with ALL types initialized
  const byType = {};
  const typeCounts = {};
  
  // Initialize all types
  Object.keys(TYPE_MAP).forEach(type => {
    byType[type] = [];
    typeCounts[type] = 0;
  });

  // Populate with actual data
  analyzed.forEach(a => {
    if (!byType[a.type]) byType[a.type] = [];
    byType[a.type].push(a);
    typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
  });

  // Remove empty types for cleaner display
  Object.keys(byType).forEach(type => {
    if (byType[type].length === 0) delete byType[type];
    if (typeCounts[type] === 0) delete typeCounts[type];
  });

  const result = {
    announcements: analyzed,
    total: analyzed.length,
    highImpact: analyzed.filter(a => Math.abs(a.score) >= 5),
    positive: analyzed.filter(a => a.score > 0),
    negative: analyzed.filter(a => a.score < 0),
    results: analyzed.filter(a => a.type === 'FR'),
    dividends: analyzed.filter(a => a.type === 'DIV'),
    boardMeetings: analyzed.filter(a => a.type === 'BM'),
    materialInfo: analyzed.filter(a => a.type === 'MI'),
    updates: analyzed.filter(a => a.type === 'U'),
    byType,
    typeCounts,
    // Available tabs for UI filtering
    tabs: Object.entries(typeCounts).map(([type, count]) => ({
      type,
      count,
      icon: TYPE_MAP[type]?.icon || '📢',
      label: TYPE_MAP[type]?.short || type,
      color: TYPE_MAP[type]?.color || '#9ca3af'
    })).sort((a, b) => b.count - a.count),
    timestamp: new Date().toISOString(),
  };

  if (!date) { 
    cache = { data: result, ts: now }; 
    console.log(`📢 Processed ${analyzed.length} announcements with ${Object.keys(typeCounts).length} types`);
  }
  
  return result;
}

// ─── HELPER FUNCTIONS ───────────────────────────────────────────────────────
async function getStockAnnouncement(symbol) {
  const data = await getAnnouncements();
  return data.announcements.find(a => a.symbol === symbol.toUpperCase()) || null;
}

async function getQuickAnnouncements() {
  const data = await getAnnouncements();
  return {
    total: data.total,
    highImpact: data.highImpact.slice(0, 5),
    topTypes: Object.entries(data.typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({
        type, 
        count, 
        icon: TYPE_MAP[type]?.icon || '📢', 
        label: TYPE_MAP[type]?.short || type,
        color: TYPE_MAP[type]?.color || '#9ca3af'
      })),
    timestamp: data.timestamp,
  };
}

// Get announcements filtered by specific type
async function getAnnouncementsByType(type, { date, forceRefresh = false } = {}) {
  const data = await getAnnouncements({ date, forceRefresh });
  return {
    type,
    typeInfo: TYPE_MAP[type] || null,
    announcements: data.byType[type] || [],
    total: data.typeCounts[type] || 0,
  };
}

// Get all available announcement types with counts
async function getAnnouncementTypes() {
  const data = await getAnnouncements();
  return data.tabs;
}

module.exports = { 
  getAnnouncements, 
  getStockAnnouncement, 
  getQuickAnnouncements,
  getAnnouncementsByType,
  getAnnouncementTypes,
  TYPE_MAP 
};