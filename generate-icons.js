const fs = require('fs');
const { createCanvas } = require('canvas');

function generateIcon(size) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, size, size);
    
    // Simple chart icon
    const scale = size / 512;
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.moveTo(156 * scale, 300 * scale);
    ctx.lineTo(256 * scale, 150 * scale);
    ctx.lineTo(356 * scale, 300 * scale);
    ctx.closePath();
    ctx.fill();
    
    // Bars
    const barWidth = 30 * scale;
    const gap = 50 * scale;
    const baseY = 400 * scale;
    
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(100 * scale, baseY - 60 * scale, barWidth, 60 * scale);
    ctx.fillRect(200 * scale, baseY - 80 * scale, barWidth, 80 * scale);
    
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(300 * scale, baseY - 50 * scale, barWidth, 50 * scale);
    ctx.fillRect(400 * scale, baseY - 70 * scale, barWidth, 70 * scale);
    
    return canvas.toBuffer();
}

try {
    const icon192 = generateIcon(192);
    const icon512 = generateIcon(512);
    
    fs.writeFileSync('public/icons/icon-192.png', icon192);
    fs.writeFileSync('public/icons/icon-512.png', icon512);
    
    console.log('✅ Icons generated successfully!');
} catch (error) {
    console.error('❌ Error generating icons:', error.message);
    console.log('Install canvas: npm install canvas');
}