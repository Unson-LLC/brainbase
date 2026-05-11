// @ts-check
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const CONFIG_PARSER_PATH = path.resolve('lib/config-parser.js');
const CONFIG_SERVICE_PATH = path.resolve('server/services/config-service.js');

describe('phase0 INV-4: ConfigParser cache invalidation', () => {
    it('INV-4: ConfigParser has invalidateCache method', () => {
        const source = fs.readFileSync(CONFIG_PARSER_PATH, 'utf8');
        expect(source).toMatch(/invalidateCache\s*\(/);
    });

    it('INV-4: ConfigService._saveConfig calls configParser.invalidateCache', () => {
        const source = fs.readFileSync(CONFIG_SERVICE_PATH, 'utf8');
        expect(source).toMatch(/this\.configParser\.invalidateCache/);
    });
});
