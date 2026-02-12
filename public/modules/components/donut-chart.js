import { clampScoreValue, getScoreColor } from './chart-colors.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const createSvgElement = (tag, attributes = {}) => {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        element.setAttribute(key, value);
    });
    return element;
};

export class DonutChart {
    constructor(container, options = {}) {
        this.container = container;
        this.value = clampScoreValue(options.value || 0);
        this.label = options.label || '';
        this.size = options.size || 280; // Default size for center donut
        this.strokeWidth = options.strokeWidth || 20;
        this.fontSize = options.fontSize || 64;
        this.color = options.color || getScoreColor(this.value);
        this.render();
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = '';

        const svg = createSvgElement('svg', {
            width: this.size,
            height: this.size,
            viewBox: `0 0 ${this.size} ${this.size}`
        });

        const center = this.size / 2;
        const radius = center - (this.strokeWidth / 2) - 10; // Padding
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (this.value / 100) * circumference;

        const circles = [
            createSvgElement('circle', {
                cx: center,
                cy: center,
                r: radius,
                fill: 'none',
                stroke: 'rgba(255, 255, 255, 0.1)',
                'stroke-width': this.strokeWidth
            }),
            createSvgElement('circle', {
                cx: center,
                cy: center,
                r: radius,
                fill: 'none',
                stroke: this.color,
                'stroke-width': this.strokeWidth,
                'stroke-dasharray': circumference,
                'stroke-dashoffset': offset,
                transform: `rotate(-90 ${center} ${center})`,
                'stroke-linecap': 'round'
            })
        ];

        circles.forEach(circle => svg.appendChild(circle));

        const scoreText = createSvgElement('text', {
            x: center,
            y: center + (this.fontSize / 3),
            'text-anchor': 'middle',
            fill: '#ffffff',
            'font-size': this.fontSize,
            'font-weight': 'bold',
            'font-family': 'Inter, sans-serif'
        });
        scoreText.textContent = `${this.value}%`;
        svg.appendChild(scoreText);

        if (this.label) {
            svg.appendChild(this._createLabel(center));
        }

        this.container.appendChild(svg);
    }

    _createLabel(center) {
        const isSmallChart = this.size < 200;
        const labelText = createSvgElement('text', {
            x: center,
            y: isSmallChart ? this.size - 5 : center + (this.fontSize / 3) + 30,
            'text-anchor': 'middle',
            fill: '#6f87a0',
            'font-size': isSmallChart ? 14 : 16,
            'font-family': 'Inter, sans-serif'
        });
        labelText.textContent = this.label;
        return labelText;
    }
}
