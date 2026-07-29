// Simple canvas-based mini charts for stock cards
class MiniChart {
    constructor(canvas, data, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.data = data || [];
        this.options = {
            width: options.width || 100,
            height: options.height || 30,
            lineColor: options.lineColor || '#22c55e',
            fillColor: options.fillColor || 'rgba(34, 197, 94, 0.1)',
            ...options
        };
        
        this.draw();
    }
    
    draw() {
        const { ctx, canvas, data, options } = this;
        const { width, height, lineColor, fillColor } = options;
        
        canvas.width = width * 2;
        canvas.height = height * 2;
        ctx.scale(2, 2);
        
        if (data.length < 2) return;
        
        const max = Math.max(...data);
        const min = Math.min(...data);
        const range = max - min || 1;
        
        const points = data.map((value, index) => ({
            x: (index / (data.length - 1)) * width,
            y: height - ((value - min) / range) * height
        }));
        
        // Draw fill
        ctx.beginPath();
        ctx.moveTo(points[0].x, height);
        points.forEach(point => ctx.lineTo(point.x, point.y));
        ctx.lineTo(points[points.length - 1].x, height);
        ctx.fillStyle = fillColor;
        ctx.fill();
        
        // Draw line
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.forEach(point => ctx.lineTo(point.x, point.y));
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
}

// Make available globally
window.MiniChart = MiniChart;