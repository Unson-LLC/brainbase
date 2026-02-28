import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DonutChart } from '../../../../public/modules/components/donut-chart.js';

/**
 * DonutChart コンポーネントテスト
 *
 * テスト対象:
 * 1. constructor() - 初期化・デフォルト値
 * 2. getColor() - 値に応じた色の決定
 * 3. render() - SVG要素の作成
 */

describe('DonutChart', () => {
    let container;

    beforeEach(() => {
        // コンテナのモック
        container = document.createElement('div');
    });

    // ==================== 1. constructor() ====================

    describe('constructor()', () => {
        it('デフォルト値で初期化される', () => {
            const chart = new DonutChart(container);

            expect(chart.container).toBe(container);
            expect(chart.value).toBe(0);
            expect(chart.label).toBe('');
            expect(chart.size).toBe(280); // デフォルトサイズ
            expect(chart.strokeWidth).toBe(20);
            expect(chart.fontSize).toBe(64);
            expect(chart.color).toBe('#ee4f27'); // value=0の場合は赤
        });

        it('カスタム値で初期化される', () => {
            const options = {
                value: 85,
                label: 'Test Project',
                size: 160,
                strokeWidth: 15,
                fontSize: 48
            };

            const chart = new DonutChart(container, options);

            expect(chart.value).toBe(85);
            expect(chart.label).toBe('Test Project');
            expect(chart.size).toBe(160);
            expect(chart.strokeWidth).toBe(15);
            expect(chart.fontSize).toBe(48);
            expect(chart.color).toBe('#35a670'); // 緑
        });

        it('color未指定時_getColor()で自動決定される', () => {
            const chart1 = new DonutChart(container, { value: 80 });
            expect(chart1.color).toBe('#35a670'); // 緑

            const chart2 = new DonutChart(container, { value: 60 });
            expect(chart2.color).toBe('#ff9b26'); // 黄

            const chart3 = new DonutChart(container, { value: 30 });
            expect(chart3.color).toBe('#ee4f27'); // 赤
        });

        it('初期化時_render()が呼ばれる', () => {
            const chart = new DonutChart(container, { value: 75 });

            // SVG要素が作成されたことを確認
            const svg = container.querySelector('svg');
            expect(svg).toBeTruthy();
        });
    });

    // ==================== 2. getColor() ====================

    describe('getColor()', () => {
        let chart;

        beforeEach(() => {
            chart = new DonutChart(container);
        });

        it('value >= 70の場合_緑を返す', () => {
            expect(chart.getColor(70)).toBe('#35a670');
            expect(chart.getColor(80)).toBe('#35a670');
            expect(chart.getColor(100)).toBe('#35a670');
        });

        it('50 <= value < 70の場合_黄を返す', () => {
            expect(chart.getColor(50)).toBe('#ff9b26');
            expect(chart.getColor(60)).toBe('#ff9b26');
            expect(chart.getColor(69)).toBe('#ff9b26');
        });

        it('value < 50の場合_赤を返す', () => {
            expect(chart.getColor(0)).toBe('#ee4f27');
            expect(chart.getColor(30)).toBe('#ee4f27');
            expect(chart.getColor(49)).toBe('#ee4f27');
        });
    });

    // ==================== 3. render() ====================

    describe('render()', () => {
        it('SVGが作成される', () => {
            new DonutChart(container, { value: 75 });

            const svg = container.querySelector('svg');
            expect(svg).toBeTruthy();
            expect(svg.tagName).toBe('svg');
        });

        it('SVGのサイズが設定される', () => {
            new DonutChart(container, { value: 75, size: 280 });

            const svg = container.querySelector('svg');
            expect(svg.getAttribute('width')).toBe('280');
            expect(svg.getAttribute('height')).toBe('280');
            expect(svg.getAttribute('viewBox')).toBe('0 0 280 280');
        });

        it('背景円が描画される', () => {
            new DonutChart(container, { value: 75, size: 280, strokeWidth: 20 });

            const circles = container.querySelectorAll('circle');
            expect(circles.length).toBeGreaterThanOrEqual(2); // 背景円 + 値円

            // 背景円の確認（1つ目のcircle）
            const bgCircle = circles[0];
            expect(bgCircle.getAttribute('cx')).toBe('140'); // center = 280/2
            expect(bgCircle.getAttribute('cy')).toBe('140');
            expect(bgCircle.getAttribute('fill')).toBe('none');
            expect(bgCircle.getAttribute('stroke')).toBe('rgba(255, 255, 255, 0.1)');
            expect(bgCircle.getAttribute('stroke-width')).toBe('20');
        });

        it('値円が描画される', () => {
            new DonutChart(container, { value: 75, size: 280, strokeWidth: 20 });

            const circles = container.querySelectorAll('circle');
            const valueCircle = circles[1]; // 2つ目のcircle

            expect(valueCircle.getAttribute('cx')).toBe('140');
            expect(valueCircle.getAttribute('cy')).toBe('140');
            expect(valueCircle.getAttribute('fill')).toBe('none');
            expect(valueCircle.getAttribute('stroke')).toBe('#35a670'); // value=75は緑
            expect(valueCircle.getAttribute('stroke-width')).toBe('20');
            expect(valueCircle.getAttribute('stroke-linecap')).toBe('round');
        });

        it('stroke-dasharrayとstroke-dashoffsetが正しく設定される', () => {
            new DonutChart(container, { value: 75, size: 280, strokeWidth: 20 });

            const circles = container.querySelectorAll('circle');
            const valueCircle = circles[1];

            // center = 280/2 = 140
            // radius = 140 - (20/2) - 10 = 120
            // circumference = 2 * PI * 120 ≈ 753.98
            const center = 280 / 2;
            const radius = center - (20 / 2) - 10;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (75 / 100) * circumference;

            expect(valueCircle.getAttribute('stroke-dasharray')).toBe(circumference.toString());
            expect(valueCircle.getAttribute('stroke-dashoffset')).toBe(offset.toString());
        });

        it('中央テキスト_スコア_が描画される', () => {
            new DonutChart(container, { value: 75, size: 280, fontSize: 64 });

            const text = container.querySelector('text');
            expect(text).toBeTruthy();
            expect(text.textContent).toBe('75%');
            expect(text.getAttribute('x')).toBe('140'); // center
            expect(text.getAttribute('text-anchor')).toBe('middle');
            expect(text.getAttribute('fill')).toBe('#ffffff');
            expect(text.getAttribute('font-size')).toBe('64');
            expect(text.getAttribute('font-weight')).toBe('bold');
        });

        it('小さいサイズ_label付き_の場合_下部にラベルが描画される', () => {
            new DonutChart(container, { value: 75, size: 160, label: 'Small Donut' });

            const texts = container.querySelectorAll('text');
            expect(texts.length).toBe(2); // スコア + ラベル

            const labelText = texts[0]; // labelTextが先に追加される
            expect(labelText.textContent).toBe('Small Donut');
            expect(labelText.getAttribute('y')).toBe('155'); // size - 5 = 160 - 5
            expect(labelText.getAttribute('fill')).toBe('#6f87a0');
            expect(labelText.getAttribute('font-size')).toBe('14');
        });

        it('大きいサイズ_label付き_の場合_スコア下にラベルが描画される', () => {
            new DonutChart(container, { value: 75, size: 280, label: 'Large Donut', fontSize: 64 });

            const texts = container.querySelectorAll('text');
            expect(texts.length).toBe(2); // スコア + ラベル

            const labelText = texts[0]; // labelTextが先に追加される
            expect(labelText.textContent).toBe('Large Donut');
            // y = center + (fontSize / 3) + 30 = 140 + (64/3) + 30 ≈ 191.33
            expect(labelText.getAttribute('fill')).toBe('#6f87a0');
            expect(labelText.getAttribute('font-size')).toBe('16');
        });

        it('label未指定時_ラベルが描画されない', () => {
            new DonutChart(container, { value: 75 });

            const texts = container.querySelectorAll('text');
            expect(texts.length).toBe(1); // スコアのみ
        });

        it('既存のコンテンツがクリアされる', () => {
            container.innerHTML = '<div>Old content</div>';

            new DonutChart(container, { value: 75 });

            // SVGのみが残る（innerHTMLは''にリセット後、svgが追加される）
            expect(container.children.length).toBe(1);
            expect(container.children[0].tagName).toBe('svg');
        });
    });

    // ==================== 4. 統合テスト ====================

    describe('統合テスト', () => {
        it('高スコア_85_で緑のドーナツが描画される', () => {
            const chart = new DonutChart(container, {
                value: 85,
                label: 'High Score',
                size: 280
            });

            expect(chart.color).toBe('#35a670'); // 緑

            const svg = container.querySelector('svg');
            expect(svg).toBeTruthy();

            const circles = container.querySelectorAll('circle');
            const valueCircle = circles[1];
            expect(valueCircle.getAttribute('stroke')).toBe('#35a670');

            const texts = container.querySelectorAll('text');
            expect(texts[1].textContent).toBe('85%'); // scoreTextは2番目
        });

        it('中スコア_60_で黄のドーナツが描画される', () => {
            const chart = new DonutChart(container, {
                value: 60,
                label: 'Medium Score'
            });

            expect(chart.color).toBe('#ff9b26'); // 黄

            const circles = container.querySelectorAll('circle');
            const valueCircle = circles[1];
            expect(valueCircle.getAttribute('stroke')).toBe('#ff9b26');

            const texts = container.querySelectorAll('text');
            expect(texts[1].textContent).toBe('60%'); // scoreTextは2番目
        });

        it('低スコア_30_で赤のドーナツが描画される', () => {
            const chart = new DonutChart(container, {
                value: 30,
                label: 'Low Score'
            });

            expect(chart.color).toBe('#ee4f27'); // 赤

            const circles = container.querySelectorAll('circle');
            const valueCircle = circles[1];
            expect(valueCircle.getAttribute('stroke')).toBe('#ee4f27');

            const texts = container.querySelectorAll('text');
            expect(texts[1].textContent).toBe('30%'); // scoreTextは2番目
        });

        it('小さいサイズ_160px_で正しく描画される', () => {
            new DonutChart(container, {
                value: 75,
                label: 'Small',
                size: 160,
                strokeWidth: 15,
                fontSize: 48
            });

            const svg = container.querySelector('svg');
            expect(svg.getAttribute('width')).toBe('160');
            expect(svg.getAttribute('height')).toBe('160');

            const texts = container.querySelectorAll('text');
            expect(texts[1].getAttribute('font-size')).toBe('48'); // scoreTextは2番目

            expect(texts.length).toBe(2); // スコア + ラベル（下部）
        });

        it('大きいサイズ_280px_で正しく描画される', () => {
            new DonutChart(container, {
                value: 75,
                label: 'Large',
                size: 280,
                strokeWidth: 20,
                fontSize: 64
            });

            const svg = container.querySelector('svg');
            expect(svg.getAttribute('width')).toBe('280');
            expect(svg.getAttribute('height')).toBe('280');

            const texts = container.querySelectorAll('text');
            expect(texts[1].getAttribute('font-size')).toBe('64'); // scoreTextは2番目

            expect(texts.length).toBe(2); // スコア + ラベル（スコア下）
        });

        it('value=0でも正しく描画される', () => {
            const chart = new DonutChart(container, { value: 0 });

            expect(chart.color).toBe('#ee4f27'); // 赤

            const text = container.querySelector('text');
            expect(text.textContent).toBe('0%');

            const circles = container.querySelectorAll('circle');
            const valueCircle = circles[1];

            // value=0の場合、offset = circumference（円弧が描画されない）
            const center = 280 / 2;
            const radius = center - (20 / 2) - 10;
            const circumference = 2 * Math.PI * radius;
            expect(valueCircle.getAttribute('stroke-dashoffset')).toBe(circumference.toString());
        });

        it('value=100でも正しく描画される', () => {
            const chart = new DonutChart(container, { value: 100 });

            expect(chart.color).toBe('#35a670'); // 緑

            const text = container.querySelector('text');
            expect(text.textContent).toBe('100%');

            const circles = container.querySelectorAll('circle');
            const valueCircle = circles[1];

            // value=100の場合、offset = 0（完全な円）
            expect(valueCircle.getAttribute('stroke-dashoffset')).toBe('0');
        });
    });
});
