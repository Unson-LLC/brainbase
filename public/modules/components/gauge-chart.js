export class GaugeChart {
    constructor(container, options = {}) {
        this.container = container;
        this.value = options.value || 0;
        this.subtitle = options.subtitle || '';
        this.color = this.getColor(this.value);
        this.render();
    }

    getColor(value) {
        if (value >= 70) return '#35a670'; // 緑
        if (value >= 50) return '#ff9b26'; // 黄
        return '#ee4f27'; // 赤
    }

    render() {
        // Clear container
        this.container.innerHTML = '';

        // Canvas API で半円ゲージを描画
        const canvas = document.createElement('canvas');
        // Set display size (css pixels)
        const width = 160;
        const height = 120;
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";

        // Set actual size in memory (scaled to account for extra pixel density)
        const scale = window.devicePixelRatio; // Change to 1 on retina screens to see blurry canvas
        canvas.width = Math.floor(width * scale);
        canvas.height = Math.floor(height * scale);

        // Normalize coordinate system to use css pixels
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);

        this.container.appendChild(canvas);
        this.drawGauge(ctx);
    }

    drawGauge(ctx) {
        const centerX = 80;
        const centerY = 100;
        const radius = 70;
        const startAngle = Math.PI;
        const endAngle = 2 * Math.PI;
        const valueAngle = startAngle + (endAngle - startAngle) * (this.value / 100);

        // 背景円弧（グレー）
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.lineWidth = 12;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineCap = 'round';
        ctx.stroke();

        // 値円弧（色付き）
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, valueAngle);
        ctx.lineWidth = 12;
        ctx.strokeStyle = this.color;
        ctx.lineCap = 'round';
        ctx.stroke();

        // 中央テキスト（スコア）
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 32px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.value, centerX, centerY - 15);

        // サブタイトル（スコア説明）
        if (this.subtitle) {
            ctx.fillStyle = '#6f87a0';
            ctx.font = '10px Inter, sans-serif';
            ctx.fillText(this.subtitle, centerX, centerY + 5);
        }

        // ラベル（プロジェクト名など）
        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px Inter, sans-serif';
        ctx.fillText(this.label, centerX, centerY + 30);
    }
}
