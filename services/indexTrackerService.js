'use strict';

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'index-tracker.json');

class IndexTrackerService {
    constructor() {
        this.trackerData = this.loadData();
    }

    loadData() {
        try {
            if (fs.existsSync(DATA_FILE)) {
                const raw = fs.readFileSync(DATA_FILE, 'utf8');
                const data = JSON.parse(raw);
                const today = new Date().toISOString().split('T')[0];
                if (data.date === today) {
                    return data;
                }
            }
        } catch (e) {}
        
        return this.createFreshData();
    }

    createFreshData() {
        return {
            date: new Date().toISOString().split('T')[0],
            dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
            marketSchedule: this.getMarketSchedule(),
            kse100: {
                open: null,
                previousClose: null,
                high: null,
                low: null,
                current: null,
                change: 0,
                changePercent: 0,
                volume: 0,
                entries: []
            },
                        allShares: {
                open: null,
                previousClose: null,  // ✅ ADDED
                high: null,
                low: null,
                current: null,
                change: 0,
                changePercent: 0,
                volume: 0,
                entries: []
            },
            volumeAnalysis: {
                totalVolume: 0,
                avgVolumePerMin: 0,
                trend: 'INIT',
                remarks: [],
                peakTime: null,
                peakVolume: 0
            },
            sessionStatus: 'WAITING', // WAITING, PRE_OPEN, OPEN, BREAK, CLOSED
            lastUpdated: null
        };
    }

    /**
     * Get PSX market schedule based on day
     * Mon-Thu: 9:32 AM - 3:30 PM
     * Friday: 9:32 AM - 12:00 PM (break), 2:32 PM - 4:30 PM
     * Sat-Sun: CLOSED
     */
    getMarketSchedule() {
        const day = new Date().getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
        
        if (day === 0 || day === 6) {
            return { type: 'WEEKEND', sessions: [], note: 'Market Closed - Weekend' };
        } else if (day === 5) {
            // Friday
            return {
                type: 'FRIDAY',
                sessions: [
                    { name: 'Session 1', start: '09:32', end: '12:00', label: 'Morning Session' },
                    { name: 'Session 2', start: '14:32', end: '16:30', label: 'Afternoon Session' }
                ],
                preOpen: { start: '09:15', end: '09:32' },
                break: { start: '12:00', end: '14:32', label: 'Friday Prayer Break' },
                note: 'Friday Trading: 9:32-12:00 & 2:32-4:30'
            };
        } else {
            // Monday-Thursday
            return {
                type: 'WEEKDAY',
                sessions: [
                    { name: 'Continuous', start: '09:32', end: '15:30', label: 'Full Day Trading' }
                ],
                preOpen: { start: '09:15', end: '09:32' },
                note: 'Regular Trading: 9:32 AM - 3:30 PM'
            };
        }
    }

    /**
     * Check if market is currently open for recording
     */
    isRecordingTime() {
        const now = new Date();
        const pkTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
        const hours = pkTime.getHours();
        const minutes = pkTime.getMinutes();
        const day = pkTime.getDay();
        const timeInMinutes = hours * 60 + minutes;

        // Weekend
        if (day === 0 || day === 6) return false;

        // Pre-open (record for opening snapshot)
        const preOpenStart = 9 * 60 + 15;
        const preOpenEnd = 9 * 60 + 32;
        if (timeInMinutes >= preOpenStart && timeInMinutes < preOpenEnd) {
            this.trackerData.sessionStatus = 'PRE_OPEN';
            return true; // Record pre-open data
        }

        if (day === 5) {
            // Friday Session 1: 9:32 - 12:00
            const fridayStart1 = 9 * 60 + 32;
            const fridayEnd1 = 12 * 60;
            if (timeInMinutes >= fridayStart1 && timeInMinutes <= fridayEnd1) {
                this.trackerData.sessionStatus = 'OPEN';
                return true;
            }

            // Friday Break: 12:00 - 14:32
            const fridayBreakStart = 12 * 60;
            const fridayBreakEnd = 14 * 60 + 32;
            if (timeInMinutes > fridayBreakStart && timeInMinutes < fridayBreakEnd) {
                this.trackerData.sessionStatus = 'BREAK';
                return false; // Don't record during break
            }

            // Friday Session 2: 14:32 - 16:30
            const fridayStart2 = 14 * 60 + 32;
            const fridayEnd2 = 16 * 60 + 30;
            if (timeInMinutes >= fridayStart2 && timeInMinutes <= fridayEnd2) {
                this.trackerData.sessionStatus = 'OPEN';
                return true;
            }
        } else {
            // Mon-Thu: 9:32 - 15:30
            const weekdayStart = 9 * 60 + 32;
            const weekdayEnd = 15 * 60 + 30;
            if (timeInMinutes >= weekdayStart && timeInMinutes <= weekdayEnd) {
                this.trackerData.sessionStatus = 'OPEN';
                return true;
            }
        }

        this.trackerData.sessionStatus = 'CLOSED';
        return false;
    }

    saveData() {
        try {
            const dir = path.dirname(DATA_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(DATA_FILE, JSON.stringify(this.trackerData, null, 2));
        } catch (e) {
            console.error('Failed to save index tracker data:', e.message);
        }
    }

    /**
     * Record a snapshot of index values
     */
    recordSnapshot(kse100Data, allSharesData) {
        // Check if data is from today, if not reset
        const today = new Date().toISOString().split('T')[0];
        if (this.trackerData.date !== today) {
            this.trackerData = this.createFreshData();
        }

        if (!this.isRecordingTime()) {
            return this.trackerData;
        }

        const now = new Date();
        const pkTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
        const timeStr = pkTime.toTimeString().split(' ')[0].substring(0, 5); // HH:MM

        // Determine session label
        const hours = pkTime.getHours();
        const minutes = pkTime.getMinutes();
        const day = pkTime.getDay();
        let sessionLabel = 'Regular';
        if (day === 5) {
            if (hours < 12 || (hours === 12 && minutes === 0)) {
                sessionLabel = 'Fri Session 1';
            } else if (hours >= 14) {
                sessionLabel = 'Fri Session 2';
            }
        }

        // KSE-100 entry
        if (kse100Data) {
            const prevEntry = this.trackerData.kse100.entries.length > 0 
                ? this.trackerData.kse100.entries[this.trackerData.kse100.entries.length - 1] 
                : null;

                        const rawValue = +kse100Data.value || 0;
            const rawChange = +kse100Data.change || 0;
            // Derive previousClose for fallback calculation
            const prevClose = this.trackerData.kse100.previousClose || (rawValue - rawChange) || rawValue;

            const kseEntry = {
                time: timeStr,
                timestamp: now.toISOString(),
                session: sessionLabel,
                value: rawValue,
                change: rawChange,
                // ✅ FIX: Fallback to self-calculated change% if API omits it
                changePercent: +kse100Data.changePercent || (prevClose ? +((rawChange / prevClose) * 100).toFixed(2) : 0),
                volume: +kse100Data.volume || 0,
                high: +kse100Data.high || 0,
                low: +kse100Data.low || 0,
                // Value added since last entry
                valueAdded: prevEntry ? +((+kse100Data.value || 0) - prevEntry.value).toFixed(2) : 0,
                // Volume added since last entry
                volumeAdded: prevEntry ? Math.max(0, (+kse100Data.volume || 0) - prevEntry.volume) : 0,
                // Cumulative value added from open
                valueFromOpen: this.trackerData.kse100.open 
                    ? +((+kse100Data.value || 0) - this.trackerData.kse100.open).toFixed(2) 
                    : 0
            };

            // Set open if not set (first entry of the day)
            if (this.trackerData.kse100.open === null) {
                this.trackerData.kse100.open = kseEntry.value;
                kseEntry.valueAdded = 0;
                kseEntry.valueFromOpen = 0;
            }

            // ✅ FIX: Calculate previousClose from API data (value - change)
            // instead of incorrectly using the first intraday tick as previous close
            if (this.trackerData.kse100.previousClose === null && kseEntry.value > 0) {
                const dayChange = +kse100Data.change || 0;
                this.trackerData.kse100.previousClose = +(kseEntry.value - dayChange).toFixed(2);
            }

            // Update high/low
            if (this.trackerData.kse100.high === null || kseEntry.value > this.trackerData.kse100.high) {
                this.trackerData.kse100.high = kseEntry.value;
            }
            if (this.trackerData.kse100.low === null || kseEntry.value < this.trackerData.kse100.low) {
                this.trackerData.kse100.low = kseEntry.value;
            }

            // Update current
            this.trackerData.kse100.current = kseEntry.value;
            this.trackerData.kse100.change = kseEntry.change;
            this.trackerData.kse100.changePercent = kseEntry.changePercent;
            this.trackerData.kse100.volume = kseEntry.volume;

            // Add entry (avoid duplicates for same time)
            const existingIdx = this.trackerData.kse100.entries.findIndex(e => e.time === timeStr);
            if (existingIdx >= 0) {
                this.trackerData.kse100.entries[existingIdx] = kseEntry;
            } else {
                this.trackerData.kse100.entries.push(kseEntry);
            }
        }

        // All Shares entry
        if (allSharesData) {
            const prevAllEntry = this.trackerData.allShares.entries.length > 0 
                ? this.trackerData.allShares.entries[this.trackerData.allShares.entries.length - 1] 
                : null;

            const allEntry = {
                time: timeStr,
                timestamp: now.toISOString(),
                session: sessionLabel,
                value: +allSharesData.value || 0,
                change: +allSharesData.change || 0,
                changePercent: +allSharesData.changePercent || 0,
                volume: +allSharesData.volume || 0,
                valueAdded: prevAllEntry ? +((+allSharesData.value || 0) - prevAllEntry.value).toFixed(2) : 0,
                volumeAdded: prevAllEntry ? Math.max(0, (+allSharesData.volume || 0) - prevAllEntry.volume) : 0
            };

                        if (this.trackerData.allShares.open === null) {
                this.trackerData.allShares.open = allEntry.value;
            }
            // ✅ FIX: Also track previousClose for All Shares if API provides change
            if (this.trackerData.allShares.previousClose === null && allEntry.value > 0) {
                const allChange = +allSharesData.change || 0;
                this.trackerData.allShares.previousClose = +(allEntry.value - allChange).toFixed(2);
            }
            if (this.trackerData.allShares.high === null || allEntry.value > this.trackerData.allShares.high) {
                this.trackerData.allShares.high = allEntry.value;
            }
            if (this.trackerData.allShares.low === null || allEntry.value < this.trackerData.allShares.low) {
                this.trackerData.allShares.low = allEntry.value;
            }

            this.trackerData.allShares.current = allEntry.value;
            this.trackerData.allShares.change = allEntry.change;
            this.trackerData.allShares.changePercent = allEntry.changePercent;
            this.trackerData.allShares.volume = allEntry.volume;

            const existingIdx = this.trackerData.allShares.entries.findIndex(e => e.time === timeStr);
            if (existingIdx >= 0) {
                this.trackerData.allShares.entries[existingIdx] = allEntry;
            } else {
                this.trackerData.allShares.entries.push(allEntry);
            }
        }

        // Analyze volume trend
        this.analyzeVolumeTrend();

        this.trackerData.lastUpdated = now.toISOString();
        this.saveData();

        return this.trackerData;
    }

    /**
     * Analyze volume trends and generate remarks
     */
    analyzeVolumeTrend() {
        const entries = this.trackerData.kse100.entries;
        if (entries.length < 2) {
            this.trackerData.volumeAnalysis.trend = 'INIT';
            this.trackerData.volumeAnalysis.remarks = ['📊 Collecting data...'];
            return;
        }

        const recentEntries = entries.slice(-6);
        const volumes = recentEntries.map(e => e.volume);
        
        this.trackerData.volumeAnalysis.totalVolume = volumes.reduce((s, v) => s + v, 0);
        this.trackerData.volumeAnalysis.avgVolumePerMin = Math.round(
            this.trackerData.volumeAnalysis.totalVolume / (recentEntries.length * 15)
        );

        let peakEntry = recentEntries[0];
        recentEntries.forEach(e => {
            if (e.volume > peakEntry.volume) peakEntry = e;
        });
        this.trackerData.volumeAnalysis.peakTime = peakEntry.time;
        this.trackerData.volumeAnalysis.peakVolume = peakEntry.volume;

        const halfIdx = Math.floor(recentEntries.length / 2);
        const firstHalf = recentEntries.slice(0, halfIdx);
        const secondHalf = recentEntries.slice(halfIdx);
        const firstAvg = firstHalf.reduce((s, e) => s + e.volume, 0) / (firstHalf.length || 1);
        const secondAvg = secondHalf.reduce((s, e) => s + e.volume, 0) / (secondHalf.length || 1);

        const remarks = [];

        if (secondAvg > firstAvg * 1.3) {
            this.trackerData.volumeAnalysis.trend = 'SURGING';
            remarks.push('🔥 Volume surging — high market participation');
        } else if (secondAvg > firstAvg * 1.1) {
            this.trackerData.volumeAnalysis.trend = 'RISING';
            remarks.push('📈 Volume rising — increasing interest');
        } else if (secondAvg < firstAvg * 0.7) {
            this.trackerData.volumeAnalysis.trend = 'FALLING';
            remarks.push('📉 Volume declining — losing momentum');
        } else if (secondAvg < firstAvg * 0.9) {
            this.trackerData.volumeAnalysis.trend = 'SLOWING';
            remarks.push('🔻 Volume slowing — cautious market');
        } else {
            this.trackerData.volumeAnalysis.trend = 'STEADY';
            remarks.push('➖ Volume steady — consistent activity');
        }

        const overallAvg = this.trackerData.volumeAnalysis.totalVolume / recentEntries.length;
        const currentVol = recentEntries[recentEntries.length - 1]?.volume || 0;
        if (currentVol > overallAvg * 1.5) {
            remarks.push('💪 Current volume significantly above average');
        } else if (currentVol < overallAvg * 0.5) {
            remarks.push('😴 Current volume significantly below average');
        }

        const firstPrice = recentEntries[0]?.value || 0;
        const lastPrice = recentEntries[recentEntries.length - 1]?.value || 0;
        const priceChange = ((lastPrice - firstPrice) / (firstPrice || 1) * 100);

        if (priceChange > 0.5 && this.trackerData.volumeAnalysis.trend === 'SURGING') {
            remarks.push('🚀 Strong bullish momentum with volume confirmation');
        } else if (priceChange > 0.5 && this.trackerData.volumeAnalysis.trend === 'FALLING') {
            remarks.push('⚠️ Price rising on low volume — weak rally');
        } else if (priceChange < -0.5 && this.trackerData.volumeAnalysis.trend === 'SURGING') {
            remarks.push('🔴 Heavy selling pressure — distribution likely');
        } else if (priceChange < -0.5 && this.trackerData.volumeAnalysis.trend === 'FALLING') {
            remarks.push('📉 Declining on low volume — passive selling');
        }

        // Session-specific remark
        if (this.trackerData.sessionStatus === 'BREAK') {
            remarks.push('☕ Friday prayer break — market resumes at 2:32 PM');
        } else if (this.trackerData.sessionStatus === 'PRE_OPEN') {
            remarks.push('🌅 Pre-open session — orders being collected');
        }

        this.trackerData.volumeAnalysis.remarks = remarks;
    }

    getTrackerData() {
        // Check if data is from today
        const today = new Date().toISOString().split('T')[0];
        if (this.trackerData.date !== today) {
            this.trackerData = this.createFreshData();
        }
        return this.trackerData;
    }

    getSummary() {
        return {
            kse100: this.trackerData.kse100.current,
            kseChange: this.trackerData.kse100.changePercent,
            volume: this.trackerData.kse100.volume,
            volumeTrend: this.trackerData.volumeAnalysis.trend,
            volumeRemark: this.trackerData.volumeAnalysis.remarks[0] || '',
            entries: this.trackerData.kse100.entries.length,
            sessionStatus: this.trackerData.sessionStatus,
            schedule: this.trackerData.marketSchedule,
            lastUpdated: this.trackerData.lastUpdated
        };
    }
}

module.exports = new IndexTrackerService();