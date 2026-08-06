public/
├── index.html                    # Clean HTML (~150 lines)
├── css/
│   ├── main.css                  # Core styles + variables
│   └── components.css            # Component styles
├── js/
│   ├── config.js                 # Constants
│   ├── utils.js                  # Helper functions
│   ├── state.js                  # Global state management
│   ├── websocket.js              # WebSocket connection
│   ├── messageHandler.js         # Central message routing
│   ├── app.js                    # Main app controller
│   └── ui/
│       ├── common.js             # Shared UI functions
│       ├── market.js             # Market tab
│       ├── watchlist.js          # Watchlist tab
│       ├── modal.js              # Stock detail modal
│       ├── orderbook.js          # Order book display
│       ├── news.js               # News tab
│       ├── announcements.js      # Announcements tab
│       ├── signals.js            # Trading signals tab
│       ├── premarket.js          # Pre-market tab
│       ├── institutional.js      # Institutional tracker
│       ├── orderflow.js          # Order flow tab
│       ├── indexTracker.js       # Index tracker tab
│       ├── globalIndices.js      # Global indices tab
│       ├── sectors.js            # Sector analysis
│       ├── fipilipi.js           # FIPI/LIPI tab
│       ├── tradeJournal.js       # Trade journal
│       └── search.js             # Search tab