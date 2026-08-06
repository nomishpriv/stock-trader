// WebSocket connection management
const WS = {
    connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        try {
            State.ws = new WebSocket(`${protocol}//${location.host}`);
        } catch (e) {
            this.scheduleReconnect();
            return;
        }

        State.ws.onopen = () => {
            State.connected = true;
            UI.updateStatus();
            if (State.reconnectTimer) {
                clearTimeout(State.reconnectTimer);
                State.reconnectTimer = null;
            }
            // Request initial data
            setTimeout(() => {
                WS.send({ type: 'GET_NEWS_SIGNAL' });
                WS.send({ type: 'GET_ANNOUNCEMENTS' });
                WS.send({ type: 'GET_TRADING_SIGNALS' });
                WS.send({ type: 'GET_NEWS_TICKER' });
                WS.send({ type: 'GET_INDEX_TRACKER' });
                WS.send({ type: 'GET_ORDERFLOW' });
                WS.send({ type: 'GET_GLOBAL_INDICES' });
                WS.send({ type: 'GET_INSTITUTIONAL_SIGNALS' });
                WS.send({ type: 'GET_TRADES' });
            }, 1500);
        };

        State.ws.onclose = () => {
            State.connected = false;
            UI.updateStatus();
            WS.scheduleReconnect();
        };

        State.ws.onerror = () => {
            State.connected = false;
            UI.updateStatus();
        };

        State.ws.onmessage = (e) => {
            try {
                MessageHandler.handle(JSON.parse(e.data));
            } catch (err) {
                console.error('Message parse error:', err);
            }
        };
    },

    scheduleReconnect() {
        if (!State.reconnectTimer) {
            State.reconnectTimer = setTimeout(() => {
                State.reconnectTimer = null;
                WS.connect();
            }, CONFIG.RECONNECT_DELAY);
        }
    },

    send(msg) {
        if (State.ws && State.ws.readyState === WebSocket.OPEN) {
            State.ws.send(JSON.stringify(msg));
        }
    }
};