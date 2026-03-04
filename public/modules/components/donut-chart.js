export class DonutChart {
    constructor(container, options = {}) {
        this.container = container;
        this.value = options.value || 0;
        this.label = options.label || '';
        this.size = options.size || 280; // Default size for center donut
        this.strokeWidth = options.strokeWidth || 20;
        this.fontSize = options.fontSize || 64;
        this.color = this.getColor(this.value);
        this.render();
    }

    getColor(value) {
        if (value >= 70) return '#35a670';
        if (value >= 50) return '#ff9b26';
        return '#ee4f27';
    }

    render() {
        this.container.innerHTML = '';

        // SVGでシンプルなドーナツチャートを描画
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', this.size);
        svg.setAttribute('height', this.size);
        svg.setAttribute('viewBox', `0 0 ${this.size} ${this.size}`);

        const center = this.size / 2;
        const radius = center - (this.strokeWidth / 2) - 10; // Padding
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (this.value / 100) * circumference;

        // 背景円
        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', center);
        bgCircle.setAttribute('cy', center);
        bgCircle.setAttribute('r', radius);
        bgCircle.setAttribute('fill', 'none');
        bgCircle.setAttribute('stroke', 'rgba(255, 255, 255, 0.1)');
        bgCircle.setAttribute('stroke-width', this.strokeWidth);

        // 値円
        const valueCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        valueCircle.setAttribute('cx', center);
        valueCircle.setAttribute('cy', center);
        valueCircle.setAttribute('r', radius);
        valueCircle.setAttribute('fill', 'none');
        valueCircle.setAttribute('stroke', this.color);
        valueCircle.setAttribute('stroke-width', this.strokeWidth);
        valueCircle.setAttribute('stroke-dasharray', circumference);
        valueCircle.setAttribute('stroke-dashoffset', offset);
        valueCircle.setAttribute('transform', `rotate(-90 ${center} ${center})`);
        valueCircle.setAttribute('stroke-linecap', 'round');

        // 中央テキスト
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', center);
        text.setAttribute('y', center + (this.fontSize / 3)); // Approximate vertical center
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#ffffff');
        text.setAttribute('font-size', this.fontSize);
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('font-family', 'Inter, sans-serif');
        text.textContent = `${this.value}%`;

        // Label if small chart (below text) or if needed
        if (this.label) {
            // For smaller charts, we might want label below the donut or inside
            // Using logic from wireframe: "Bottom label" for small donuts
            if (this.size < 200) {
                const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                labelText.setAttribute('x', center);
                labelText.setAttribute('y', this.size - 5);
                labelText.setAttribute('text-anchor', 'middle');
                labelText.setAttribute('fill', '#6f87a0');
                labelText.setAttribute('font-size', '14');
                labelText.setAttribute('font-family', 'Inter, sans-serif');
                labelText.textContent = this.label;
                svg.appendChild(labelText);
            } else {
                // For large center donut, label is usually outside or distinct. 
                // Wireframe says "Central text font size 64px". 
                // Let's add label below score inside donut for large one too
                const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                labelText.setAttribute('x', center);
                labelText.setAttribute('y', center + (this.fontSize / 3) + 30);
                labelText.setAttribute('text-anchor', 'middle');
                labelText.setAttribute('fill', '#6f87a0');
                labelText.setAttribute('font-size', '16');
                labelText.setAttribute('font-family', 'Inter, sans-serif');
                labelText.textContent = this.label;
                svg.appendChild(labelText);
            }
        }

        svg.appendChild(bgCircle);
        svg.appendChild(valueCircle);
        svg.appendChild(text);
        this.container.appendChild(svg);
    }
}
