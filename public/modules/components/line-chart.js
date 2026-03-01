/**
 * LineChart Component
 * Renders a responsive SVG line chart with simple tooltips.
 */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const KEYFRAME_STYLE_ID = 'line-chart-keyframes';

export class LineChart {
    constructor(container, options = {}) {
        this.container = container;
        this.data = options.data || []; // Array of values
        this.labels = options.labels || []; // Array of labels (x-axis)
        this.color = options.color || '#3b82f6';
        this.height = options.height || 200;
        this.label = options.label || '';
        this.yAxisMax = options.yAxisMax || 100;
        this.yAxisMin = options.yAxisMin || 0;

        this.init();
    }

    init() {
        this.render();
        // Handle window resize for responsiveness
        this.resizeHandler = () => this.render();
        window.addEventListener('resize', this.resizeHandler);
    }

    destroy() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }
    }

    render() {
        this.container.innerHTML = '';

        // Dimensions
        const width = this.container.clientWidth || 300;
        const height = this.height;
        const padding = { top: 20, right: 20, bottom: 30, left: 30 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // SVG
        const svg = this.createSvgElement('svg', { width, height });
        svg.style.overflow = 'visible';

        // Grid lines (Horizontal)
        const gridCount = 5;
        for (let i = 0; i <= gridCount; i++) {
            const y = padding.top + (chartHeight * i) / gridCount;
            const line = this.createSvgElement('line', {
                x1: padding.left,
                x2: width - padding.right,
                y1: y,
                y2: y,
                stroke: 'var(--border-color)',
                'stroke-width': '1',
                'stroke-dasharray': '4 4'
            });
            svg.appendChild(line);

            // Y-axis label
            const value = this.yAxisMax - ((this.yAxisMax - this.yAxisMin) * i) / gridCount;
            const text = this.createSvgElement('text', {
                x: padding.left - 5,
                y: y + 4,
                'text-anchor': 'end',
                fill: 'var(--text-secondary)',
                'font-size': '10px'
            });
            text.textContent = Math.round(value);
            svg.appendChild(text);
        }

        // X-axis labels
        if (this.labels.length > 0) {
            this.labels.forEach((label, i) => {
                const x = padding.left + (chartWidth * i) / (this.labels.length - 1);
                const text = this.createSvgElement('text', {
                    x,
                    y: height - 5,
                    'text-anchor': 'middle',
                    fill: 'var(--text-secondary)',
                    'font-size': '10px'
                });
                text.textContent = label;
                svg.appendChild(text);
            });
        }

        // Line Path
        if (this.data.length > 1) {
            // Calculate points
            const points = this.data.map((val, i) => {
                const x = padding.left + (chartWidth * i) / (this.data.length - 1);
                // Normalized value
                const normalized = (val - this.yAxisMin) / (this.yAxisMax - this.yAxisMin);
                const y = padding.top + chartHeight - (normalized * chartHeight);
                return { x, y, value: val };
            });

            // Draw line
            let d = `M ${points[0].x} ${points[0].y}`;
            for (let i = 1; i < points.length; i++) {
                d += ` L ${points[i].x} ${points[i].y}`;
            }

            const path = this.createSvgElement('path', {
                d,
                fill: 'none',
                stroke: this.color,
                'stroke-width': '3',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round'
            });

            // Animation
            const length = path.getTotalLength ? path.getTotalLength() : 1000;
            path.style.strokeDasharray = length;
            path.style.strokeDashoffset = length;
            path.style.animation = 'dash 1s ease forwards';

            svg.appendChild(path);

            // Draw dots & interactive areas
            points.forEach((point, i) => {
                // Outer circle (halo)
                const halo = this.createSvgElement('circle', {
                    cx: point.x,
                    cy: point.y,
                    r: '6',
                    fill: this.color,
                    opacity: '0.2'
                });
                svg.appendChild(halo);

                // Inner circle
                const dot = this.createSvgElement('circle', {
                    cx: point.x,
                    cy: point.y,
                    r: '3',
                    fill: this.color
                });
                svg.appendChild(dot);

                // Transparent hit area
                const hitArea = this.createSvgElement('rect', {
                    x: point.x - 10,
                    y: padding.top,
                    width: 20,
                    height: chartHeight,
                    fill: 'transparent'
                });
                hitArea.style.cursor = 'pointer';

                // Tooltip
                const title = this.createSvgElement('title');
                title.textContent = `${this.label}\n${this.labels[i] || ''}: ${point.value}`;
                hitArea.appendChild(title);

                this.attachPointHoverHandlers(hitArea, dot, halo);

                svg.appendChild(hitArea);
            });
        }

        this.ensureAnimationStyle();
        this.container.appendChild(svg);
    }

    createSvgElement(tag, attributes = {}) {
        const element = document.createElementNS(SVG_NAMESPACE, tag);
        Object.entries(attributes).forEach(([key, value]) => {
            if (value === undefined || value === null) {
                return;
            }
            element.setAttribute(key, value);
        });
        return element;
    }

    attachPointHoverHandlers(hitArea, dot, halo) {
        hitArea.onmouseenter = () => this.togglePointHover(dot, halo, true);
        hitArea.onmouseleave = () => this.togglePointHover(dot, halo, false);
    }

    togglePointHover(dot, halo, isHovered) {
        dot.setAttribute('r', isHovered ? '5' : '3');
        halo.setAttribute('opacity', isHovered ? '0.5' : '0.2');
        halo.setAttribute('r', isHovered ? '8' : '6');
    }

    ensureAnimationStyle() {
        if (document.getElementById(KEYFRAME_STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = KEYFRAME_STYLE_ID;
        style.textContent = `
                @keyframes dash {
                    to { stroke-dashoffset: 0; }
                }
            `;
        document.head.appendChild(style);
    }
}
