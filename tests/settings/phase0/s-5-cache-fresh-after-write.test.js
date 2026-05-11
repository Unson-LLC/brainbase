// @ts-check
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('phase0 S-5: cache fresh after write', () => {
    it('S-5: ConfigService._saveConfig invalidates ConfigParser cache after fs.writeFile', () => {
        const src = fs.readFileSync(path.resolve('server/services/config-service.js'), 'utf8');
        const idxWrite = src.indexOf('await fs.writeFile(this.configPath');
        const idxInvalidate = src.indexOf('this.configParser.invalidateCache');
        expect(idxWrite).toBeGreaterThanOrEqual(0);
        expect(idxInvalidate).toBeGreaterThan(idxWrite);  // invalidate comes after write
    });
});
