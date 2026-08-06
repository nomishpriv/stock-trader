// Watchlist tab rendering
const UIWatchlist = {
    render() {
        const w = State.stocks.filter(s => State.watchlist.includes(s.symbol));
        if (!w.length) {
            document.getElementById('watchlistEmpty').style.display = 'block';
            document.getElementById('watchlistList').style.display = 'none';
        } else {
            document.getElementById('watchlistEmpty').style.display = 'none';
            document.getElementById('watchlistList').style.display = 'flex';
            document.getElementById('watchlistList').innerHTML = w.map(s => stockCard(s)).join('');
        }
    }
};