/**
 * HeatmapRow Component
 * Renders a row of blocks representing health history (GitHub contribution graph style)
 */
export class HeatmapRow {
    constructor(container, options = {}) {
        this.container = container;
        this.data = options.data || []; // Array of health scores (oldest to newest)
        this.label = options.label || 'Project';
        this.weeks = options.weeks || 4; // Number of weeks to show

        this.init();
    }

    init() {
        this.render();
    }

    getHealthColor(score) {
        if (score === null || score === undefined) return 'var(--text-secondary)'; // No data (gray)
        if (score >= 70) return 'var(--health-excellent)'; // Green
        if (score >= 50) return 'var(--health-warning)';   // Yellow
        return 'var(--health-danger)';    // Red
    }

    getOpacity(score) {
        if (score === null || score === undefined) return 0.2;
        // Higher score = more opaque (or use distinct colors as per design)
        // For this design, we use solid colors based on thresholds
        return 1.0;
    }

    render() {
        // Create row container
        const row = document.createElement('div');
        row.className = 'heatmap-row';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.marginBottom = '12px';
        row.style.gap = '16px';

        // Label
        const labelDiv = document.createElement('div');
        labelDiv.className = 'heatmap-label';
        labelDiv.textContent = this.label;
        labelDiv.style.width = '120px';
        labelDiv.style.fontSize = '14px';
        labelDiv.style.fontWeight = '500';
        labelDiv.style.color = 'var(--text-primary)';
        labelDiv.style.whiteSpace = 'nowrap';
        labelDiv.style.overflow = 'hidden';
        labelDiv.style.textOverflow = 'ellipsis';
        row.appendChild(labelDiv);

        // Blocks container
        const blocksContainer = document.createElement('div');
        blocksContainer.className = 'heatmap-blocks';
        blocksContainer.style.display = 'flex';
        blocksContainer.style.gap = '4px';
        blocksContainer.style.flex = '1';

        // Render blocks (right-aligned, newest on right)
        // Assuming data is standard array: [oldest ..... newest]
        // We take the last 'this.weeks' items
        const displayData = this.data.slice(-this.weeks);

        // Pad with null if not enough data
        while (displayData.length < this.weeks) {
            displayData.unshift(null);
        }

        displayData.forEach((score, index) => {
            const block = document.createElement('div');
            block.className = 'heatmap-block';
            block.style.width = '100%'; // Flex width
            block.style.height = '24px';
            block.style.backgroundColor = this.getHealthColor(score);
            block.style.opacity = this.getOpacity(score);
            block.style.borderRadius = '2px';
            block.style.cursor = 'pointer';
            block.style.transition = 'all 0.2s ease';

            // Tooltip
            const weekLabel = `Week ${index + 1}`;
            const status = score !== null ? `Score: ${score}` : 'No Data';
            block.title = `${this.label} - ${weekLabel}\n${status}`;

            // Hover effect (simple scaling)
            block.onmouseenter = () => {
                block.style.transform = 'scaleY(1.2)';
            };
            block.onmouseleave = () => {
                block.style.transform = 'scaleY(1)';
            };

            blocksContainer.appendChild(block);
        });

        row.appendChild(blocksContainer);
        this.container.appendChild(row);
    }
}
