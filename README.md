# 📈 Stock Trader PWA - PSX Real-Time Trading Platform

A Progressive Web App (PWA) for real-time Pakistan Stock Exchange (PSX) market data, technical analysis, order book depth, and AI-powered news trading signals.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D16-green.svg)
![PWA](https://img.shields.io/badge/PWA-ready-purple.svg)

---

## ✨ Features

### 📊 Real-Time Market Data
- Live stock prices updated every 3 seconds via WebSocket
- KSE-100 index tracking with volume analysis
- 850+ stocks with price, volume, RSI, pivot points
- Auto-flash green/red on price changes
- Right shares (R-symbols) automatically filtered out

### 📖 Order Book & Market Depth
- Real-time bid/ask order book for any stock
- Top 10 bid and ask levels with volume bars
- Large order detection (>5,000 shares)
- Buy/Sell pressure analysis
- Bid/Ask ratio and volume imbalance
- Strong support/resistance from order concentration
- Auto-refresh every 5 seconds

### 🤖 AI News Analysis (Groq LLM)
- Fetches news from Tribune, Dawn, ARY, and 9 Mettis Global APIs
- AI-powered trading signals (STRONG_BUY to STRONG_SELL)
- Sector impact analysis with specific stock recommendations
- Stock-specific news when viewing detail page
- Confidence scoring for each signal
- Auto-refreshes every 90 seconds

### ⭐ Watchlist
- Add/remove stocks to personal watchlist
- Persists in localStorage
- Real-time price updates on watchlist

### 🔍 Search
- Search by symbol or company name
- Instant results via WebSocket

### 📱 PWA Features
- Installable on mobile (Android/iOS)
- Offline support with service worker
- Native app-like experience
- Touch-optimized interface
- Dark theme optimized for trading

---

## 🏗️ Architecture
stock-trader/
├── server.js # Main server (Express + WebSocket)
├── .env # Environment variables (NOT committed)
├── .gitignore
├── package.json
├── services/
│ ├── authService.js # StockIntel API authentication
│ ├── orderBookService.js # Order book cache management
│ └── newsService.js # News fetching + Groq AI analysis
└── public/
├── index.html # Complete PWA frontend (single file)
├── manifest.json # PWA manifest
├── sw.js # Service Worker
└── icons/
├── icon-192.png
└── icon-512.png


### Tech Stack
- **Backend**: Node.js, Express, WebSocket (ws)
- **Frontend**: Vanilla JavaScript, CSS3 (no frameworks)
- **APIs**: StockIntel (PSX data), Mettis Global (news), Groq (AI analysis)
- **Auth**: JWT token with auto-refresh and file-based cache

---

## 🚀 Quick Start

### Prerequisites
- Node.js 16 or higher
- StockIntel account (for PSX data)
- Groq API key (optional, for AI news)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/stock-trader.git
cd stock-trader