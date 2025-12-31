/**
 * LineChart Component
 * Renders a responsive SVG line chart with simple tooltips.
 */
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
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.style.overflow = 'visible';

        // Grid lines (Horizontal)
        const gridCount = 5;
        for (let i = 0; i <= gridCount; i++) {
            const y = padding.top + (chartHeight * i) / gridCount;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', padding.left);
            line.setAttribute('x2', width - padding.right);
            line.setAttribute('y1', y);
            line.setAttribute('y2', y);
            line.setAttribute('stroke', 'var(--border-color)');
            line.setAttribute('stroke-width', '1');
            line.setAttribute('stroke-dasharray', '4 4');
            svg.appendChild(line);

            // Y-axis label
            const value = this.yAxisMax - ((this.yAxisMax - this.yAxisMin) * i) / gridCount;
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', padding.left - 5);
            text.setAttribute('y', y + 4);
            text.setAttribute('text-anchor', 'end');
            text.setAttribute('fill', 'var(--text-secondary)');
            text.setAttribute('font-size', '10px');
            text.textContent = Math.round(value);
            svg.appendChild(text);
        }

        // X-axis labels
        if (this.labels.length > 0) {
            this.labels.forEach((label, i) => {
                const x = padding.left + (chartWidth * i) / (this.labels.length - 1);
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', x);
                text.setAttribute('y', height - 5);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('fill', 'var(--text-secondary)');
                text.setAttribute('font-size', '10px');
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

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', this.color);
            path.setAttribute('stroke-width', '3');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');

            // Animation
            const length = path.getTotalLength ? path.getTotalLength() : 1000;
            path.style.strokeDasharray = length;
            path.style.strokeDashoffset = length;
            path.style.animation = 'dash 1s ease forwards';

            svg.appendChild(path);

            // Draw dots & interactive areas
            points.forEach((point, i) => {
                // Outer circle (halo)
                const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                halo.setAttribute('cx', point.x);
                halo.setAttribute('cy', point.y);
                halo.setAttribute('r', '6');
                halo.setAttribute('fill', this.color);
                halo.setAttribute('opacity', '0.2');
                svg.appendChild(halo);

                // Inner circle
                const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                dot.setAttribute('cx', point.x);
                dot.setAttribute('cy', point.y);
                dot.setAttribute('r', '3');
                dot.setAttribute('fill', this.color);
                svg.appendChild(dot);

                // Transparent hit area
                const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                hitArea.setAttribute('x', point.x - 10);
                hitArea.setAttribute('y', padding.top);
                hitArea.setAttribute('width', 20);
                hitArea.setAttribute('height', chartHeight);
                hitArea.setAttribute('fill', 'transparent');
                hitArea.style.cursor = 'pointer';

                // Tooltip
                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = `${this.label}\n${this.labels[i] || ''}: ${point.value}`;
                hitArea.appendChild(title);

                // Hover effect
                hitArea.onmouseenter = () => {
                    dot.setAttribute('r', '5');
                    halo.setAttribute('opacity', '0.5');
                    halo.setAttribute('r', '8');
                };
                hitArea.onmouseleave = () => {
                    dot.setAttribute('r', '3');
                    halo.setAttribute('opacity', '0.2');
                    halo.setAttribute('r', '6');
                };

                svg.appendChild(hitArea);
            });
        }

        // Add style for animation if strictly needed here, or assume it's in css
        // We'll add a style tag to the container for the keyframes if not present
        if (!document.getElementById('line-chart-keyframes')) {
            const style = document.createElement('style');
            style.id = 'line-chart-keyframes';
            style.textContent = `
                @keyframes dash {
                    to { stroke-dashoffset: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        this.container.appendChild(svg);
    }
}
