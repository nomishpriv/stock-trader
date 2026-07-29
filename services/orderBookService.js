const { api } = require('./authService');

class OrderBookService {
    constructor() {
        this.orderBooks = new Map();
    }

    getCachedOrderBook(symbol) {
        const cached = this.orderBooks.get(symbol.toUpperCase());
        if (cached && (Date.now() - cached.timestamp) < 5000) {
            return cached;
        }
        return null;
    }
}

module.exports = new OrderBookService();