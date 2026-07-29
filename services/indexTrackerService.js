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
                // Check if data is from today
                const today = new Date().toISOString().split('T')[0];
                if (data.date === today) {
                    return data;
                }
            }
        } catch (e) {}
        
        // Fresh data for today
        return {
            date: new Date().toISOString().split('T')[0],
            kse100: {
                open: null,
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
            lastUpdated: null
        };
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
        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0].substring(0, 5); // HH:MM
        
        // KSE-100 entry
        if (kse100Data) {
            const kseEntry = {
                time: timeStr,
                timestamp: now.toISOString(),
                value: +kse100Data.value || 0,
                change: +kse100Data.change || 0,
                changePercent: +kse100Data.changePercent || 0,
                volume: +kse100Data.volume || 0,
                high: +kse100Data.high || 0,
                low: +kse100Data.low || 0
            };

            // Set open if not set
            if (this.trackerData.kse100.open === null) {
                this.trackerData.kse100.open = kseEntry.value;
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
            const allEntry = {
                time: timeStr,
                timestamp: now.toISOString(),
                value: +allSharesData.value || 0,
                change: +allSharesData.change || 0,
                changePercent: +allSharesData.changePercent || 0,
                volume: +allSharesData.volume || 0
            };

            if (this.trackerData.allShares.open === null) {
                this.trackerData.allShares.open = allEntry.value;
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

        const recentEntries = entries.slice(-6); // Last 6 entries (90 minutes)
        const volumes = recentEntries.map(e => e.volume);
        
        // Total volume
        this.trackerData.volumeAnalysis.totalVolume = volumes.reduce((s, v) => s + v, 0);
        this.trackerData.volumeAnalysis.avgVolumePerMin = Math.round(
            this.trackerData.volumeAnalysis.totalVolume / (recentEntries.length * 15)
        );

        // Find peak
        let peakEntry = recentEntries[0];
        recentEntries.forEach(e => {
            if (e.volume > peakEntry.volume) peakEntry = e;
        });
        this.trackerData.volumeAnalysis.peakTime = peakEntry.time;
        this.trackerData.volumeAnalysis.peakVolume = peakEntry.volume;

        // Trend analysis
        const firstHalf = recentEntries.slice(0, Math.floor(recentEntries.length / 2));
        const secondHalf = recentEntries.slice(Math.floor(recentEntries.length / 2));
        const firstAvg = firstHalf.reduce((s, e) => s + e.volume, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((s, e) => s + e.volume, 0) / secondHalf.length;

        const remarks = [];

        // Volume trend
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

        // Volume vs average
        const overallAvg = this.trackerData.volumeAnalysis.totalVolume / recentEntries.length;
        const currentVol = recentEntries[recentEntries.length - 1]?.volume || 0;
        if (currentVol > overallAvg * 1.5) {
            remarks.push('💪 Current volume significantly above average');
        } else if (currentVol < overallAvg * 0.5) {
            remarks.push('😴 Current volume significantly below average');
        }

        // Index direction with volume
        const firstPrice = recentEntries[0]?.value || 0;
        const lastPrice = recentEntries[recentEntries.length - 1]?.value || 0;
        const priceChange = ((lastPrice - firstPrice) / firstPrice * 100);

        if (priceChange > 0.5 && this.trackerData.volumeAnalysis.trend === 'SURGING') {
            remarks.push('🚀 Strong bullish momentum with volume confirmation');
        } else if (priceChange > 0.5 && this.trackerData.volumeAnalysis.trend === 'FALLING') {
            remarks.push('⚠️ Price rising on low volume — weak rally');
        } else if (priceChange < -0.5 && this.trackerData.volumeAnalysis.trend === 'SURGING') {
            remarks.push('🔴 Heavy selling pressure — distribution likely');
        } else if (priceChange < -0.5 && this.trackerData.volumeAnalysis.trend === 'FALLING') {
            remarks.push('📉 Declining on low volume — passive selling');
        }

        this.trackerData.volumeAnalysis.remarks = remarks;
    }

    /**
     * Get current tracker data
     */
    getTrackerData() {
        return this.trackerData;
    }

    /**
     * Get summary for market bar
     */
    getSummary() {
        return {
            kse100: this.trackerData.kse100.current,
            kseChange: this.trackerData.kse100.changePercent,
            volume: this.trackerData.kse100.volume,
            volumeTrend: this.trackerData.volumeAnalysis.trend,
            volumeRemark: this.trackerData.volumeAnalysis.remarks[0] || '',
            entries: this.trackerData.kse100.entries.length,
            lastUpdated: this.trackerData.lastUpdated
        };
    }
}

module.exports = new IndexTrackerService();