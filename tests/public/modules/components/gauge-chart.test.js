import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GaugeChart } from '../../../../public/modules/components/gauge-chart.js';

/**
 * GaugeChart コンポーネントテスト
 *
 * テスト対象:
 * 1. constructor() - 初期化・デフォルト値
 * 2. getColor() - 値に応じた色の決定
 * 3. render() - Canvas要素の作成
 * 4. drawGauge() - ゲージの描画
 */

describe('GaugeChart', () => {
    let container;
    let mockCanvas;
    let mockContext;

    beforeEach(() => {
        // コンテナのモック（実際のdiv要素を作成）
        container = document.createElement('div');

        // Canvas 2D Contextのモック
        mockContext = {
            beginPath: vi.fn(),
            arc: vi.fn(),
            stroke: vi.fn(),
            fillText: vi.fn(),
            scale: vi.fn(),
            // プロパティのモック
            lineWidth: 0,
            strokeStyle: '',
            lineCap: '',
            fillStyle: '',
            font: '',
            textAlign: ''
        };

        // HTMLCanvasElement.prototype.getContext をモック（recursion回避）
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockContext);

        // window.devicePixelRatio のモック
        Object.defineProperty(window, 'devicePixelRatio', {
            writable: true,
            configurable: true,
            value: 2
        });
    });

    // ==================== 1. constructor() ====================

    describe('constructor()', () => {
        it('デフォルト値で初期化される', () => {
            const chart = new GaugeChart(container);

            expect(chart.container).toBe(container);
            expect(chart.value).toBe(0);
            expect(chart.label).toBe('');
            expect(chart.subtitle).toBe('');
            expect(chart.color).toBe('#ee4f27'); // value=0の場合は赤
        });

        it('カスタム値で初期化される', () => {
            const options = {
                value: 85,
                label: 'Test Project',
                subtitle: 'Health Score',
                color: '#35a670'
            };

            const chart = new GaugeChart(container, options);

            expect(chart.value).toBe(85);
            expect(chart.label).toBe('Test Project');
            expect(chart.subtitle).toBe('Health Score');
            expect(chart.color).toBe('#35a670');
        });

        it('color未指定時_getColor()で自動決定される', () => {
            const chart1 = new GaugeChart(container, { value: 80 });
            expect(chart1.color).toBe('#35a670'); // 緑

            const chart2 = new GaugeChart(container, { value: 60 });
            expect(chart2.color).toBe('#ff9b26'); // 黄

            const chart3 = new GaugeChart(container, { value: 30 });
            expect(chart3.color).toBe('#ee4f27'); // 赤
        });

        it('初期化時_render()が呼ばれる', () => {
            const chart = new GaugeChart(container, { value: 75 });

            // Canvasがコンテナに追加されたことを確認
            expect(container.children.length).toBe(1);
            expect(container.children[0].tagName).toBe('CANVAS');
        });
    });

    // ==================== 2. getColor() ====================

    describe('getColor()', () => {
        let chart;

        beforeEach(() => {
            chart = new GaugeChart(container);
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
        it('Canvasが作成される', () => {
            new GaugeChart(container, { value: 75 });

            const canvas = container.querySelector('canvas');
            expect(canvas).toBeTruthy();
            expect(canvas.tagName).toBe('CANVAS');
        });

        it('Canvasのサイズが設定される', () => {
            new GaugeChart(container, { value: 75 });

            const canvas = container.querySelector('canvas');

            // CSS pixels
            expect(canvas.style.width).toBe('160px');
            expect(canvas.style.height).toBe('120px');

            // Actual size (scaled)
            expect(canvas.width).toBe(320); // 160 * 2 (devicePixelRatio)
            expect(canvas.height).toBe(240); // 120 * 2
        });

        it('2D Contextが取得される', () => {
            new GaugeChart(container, { value: 75 });

            expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('2d');
        });

        it('Contextのスケールが設定される', () => {
            new GaugeChart(container, { value: 75 });

            expect(mockContext.scale).toHaveBeenCalledWith(2, 2); // devicePixelRatio
        });

        it('既存のコンテンツがクリアされる', () => {
            container.innerHTML = '<div>Old content</div>';

            new GaugeChart(container, { value: 75 });

            // Canvasのみが残る（innerHTMLは''にリセット後、canvasが追加される）
            expect(container.children.length).toBe(1);
            expect(container.children[0].tagName).toBe('CANVAS');
        });

        it('drawGauge()が呼ばれる', () => {
            new GaugeChart(container, { value: 75 });

            // drawGauge内でcontextのメソッドが呼ばれたことを確認
            expect(mockContext.beginPath).toHaveBeenCalled();
            expect(mockContext.arc).toHaveBeenCalled();
            expect(mockContext.stroke).toHaveBeenCalled();
            expect(mockContext.fillText).toHaveBeenCalled();
        });
    });

    // ==================== 4. drawGauge() ====================

    describe('drawGauge()', () => {
        it('背景円弧が描画される', () => {
            new GaugeChart(container, { value: 75 });

            // 背景円弧の描画確認（1回目のarc呼び出し）
            expect(mockContext.arc).toHaveBeenNthCalledWith(
                1, // 1回目の呼び出し
                80, // centerX
                100, // centerY
                70, // radius
                Math.PI, // startAngle
                2 * Math.PI // endAngle
            );
        });

        it('値円弧が描画される', () => {
            new GaugeChart(container, { value: 75 });

            // 値円弧の描画確認（2回目のarc呼び出し）
            const valueAngle = Math.PI + (Math.PI * (75 / 100));
            expect(mockContext.arc).toHaveBeenNthCalledWith(
                2, // 2回目の呼び出し
                80, // centerX
                100, // centerY
                70, // radius
                Math.PI, // startAngle
                valueAngle // valueAngle
            );
        });

        it('中央テキスト_スコア_が描画される', () => {
            new GaugeChart(container, { value: 75.7 });

            // Math.round(75.7) = 76
            expect(mockContext.fillText).toHaveBeenCalledWith(
                '76', // 値（四捨五入）
                80, // centerX
                85 // centerY - 15
            );
        });

        it('サブタイトルが描画される', () => {
            new GaugeChart(container, { value: 75, subtitle: 'Health Score' });

            expect(mockContext.fillText).toHaveBeenCalledWith(
                'Health Score',
                80, // centerX
                105 // centerY + 5
            );
        });

        it('サブタイトル未指定時_描画されない', () => {
            new GaugeChart(container, { value: 75 });

            // fillTextは2回呼ばれる（スコアとラベルのみ）
            expect(mockContext.fillText).toHaveBeenCalledTimes(2);
        });

        it('ラベルが描画される', () => {
            new GaugeChart(container, { value: 75, label: 'Test Project' });

            expect(mockContext.fillText).toHaveBeenCalledWith(
                'Test Project',
                80, // centerX
                130 // centerY + 30
            );
        });

        it('色が正しく設定される', () => {
            const chart = new GaugeChart(container, { value: 85 }); // 緑

            // drawGauge内で色が設定される
            // strokeStyleは値円弧描画時に設定される
            expect(mockContext.strokeStyle).toContain('#35a670');
        });
    });

    // ==================== 5. 統合テスト ====================

    describe('統合テスト', () => {
        it('高スコア_85_で緑のゲージが描画される', () => {
            const chart = new GaugeChart(container, {
                value: 85,
                label: 'High Score Project',
                subtitle: 'Health Score'
            });

            expect(chart.color).toBe('#35a670'); // 緑
            expect(mockContext.fillText).toHaveBeenCalledWith('85', 80, 85);
            expect(mockContext.fillText).toHaveBeenCalledWith('Health Score', 80, 105);
            expect(mockContext.fillText).toHaveBeenCalledWith('High Score Project', 80, 130);
        });

        it('中スコア_60_で黄のゲージが描画される', () => {
            const chart = new GaugeChart(container, {
                value: 60,
                label: 'Medium Score Project',
                subtitle: 'Health Score'
            });

            expect(chart.color).toBe('#ff9b26'); // 黄
            expect(mockContext.fillText).toHaveBeenCalledWith('60', 80, 85);
        });

        it('低スコア_30_で赤のゲージが描画される', () => {
            const chart = new GaugeChart(container, {
                value: 30,
                label: 'Low Score Project',
                subtitle: 'Health Score'
            });

            expect(chart.color).toBe('#ee4f27'); // 赤
            expect(mockContext.fillText).toHaveBeenCalledWith('30', 80, 85);
        });

        it('devicePixelRatio=1の場合_スケールが正しく適用される', () => {
            window.devicePixelRatio = 1;

            new GaugeChart(container, { value: 75 });

            const canvas = container.querySelector('canvas');

            // Canvas実サイズ
            expect(canvas.width).toBe(160); // 160 * 1
            expect(canvas.height).toBe(120); // 120 * 1

            // Contextスケール
            expect(mockContext.scale).toHaveBeenCalledWith(1, 1);
        });
    });
});
