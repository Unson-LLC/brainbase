import { clampScoreValue, getScoreColor } from './chart-colors.js';

const DEFAULT_CANVAS_SIZE = { width: 160, height: 150 };
const CENTER = { x: 80, y: 100 };
const RADIUS = 70;
const STROKE_WIDTH = 12;
const BACKGROUND_STROKE = 'rgba(255, 255, 255, 0.1)';

const drawText = (ctx, text, { x, y, color, font }) => {
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y);
};

export class GaugeChart {
    constructor(container, options = {}) {
        this.container = container;
        this.value = clampScoreValue(options.value || 0);
        this.label = options.label || '';
        this.subtitle = options.subtitle || '';
        this.color = options.color || getScoreColor(this.value);
        this.size = options.size || DEFAULT_CANVAS_SIZE;
        this.radius = options.radius || RADIUS;
        this.center = {
            x: options.center?.x ?? CENTER.x,
            y: options.center?.y ?? CENTER.y
        };
        this.render();
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = '';
        const ctx = this._createContext();
        if (!ctx) return;
        this.drawGauge(ctx);
    }

    _createContext() {
        const { width, height } = this.size;
        const canvas = document.createElement('canvas');
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        const scale = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
        canvas.width = Math.floor(width * scale);
        canvas.height = Math.floor(height * scale);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }
        ctx.scale(scale, scale);
        this.container.appendChild(canvas);
        return ctx;
    }

    drawGauge(ctx) {
        const { x: centerX, y: centerY } = this.center;
        const radius = this.radius;
        const startAngle = Math.PI;
        const endAngle = 2 * Math.PI;
        const valueAngle = startAngle + (endAngle - startAngle) * (this.value / 100);

        ctx.lineWidth = STROKE_WIDTH;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.strokeStyle = BACKGROUND_STROKE;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, valueAngle);
        ctx.strokeStyle = this.color;
        ctx.stroke();

        drawText(ctx, Math.round(this.value).toString(), {
            x: centerX,
            y: centerY - 15,
            color: '#ffffff',
            font: 'bold 32px Inter, sans-serif'
        });

        if (this.subtitle) {
            drawText(ctx, this.subtitle, {
                x: centerX,
                y: centerY + 5,
                color: '#6f87a0',
                font: '10px Inter, sans-serif'
            });
        }

        if (this.label) {
            drawText(ctx, this.label, {
                x: centerX,
                y: centerY + 30,
                color: '#ffffff',
                font: 'bold 15px Inter, sans-serif'
            });
        }
    }
}
