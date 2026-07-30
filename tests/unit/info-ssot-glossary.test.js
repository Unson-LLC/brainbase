import { describe, expect, it } from 'vitest';
import { parseGlossaryAliases } from '../../lib/info-ssot/glossary.js';

describe('parseGlossaryAliases', () => {
  it('turns glossary recognition patterns into searchable aliases', () => {
    expect(parseGlossaryAliases('James, 場面, ゼイムス、じえいむず，ジェームス')).toEqual([
      'James',
      '場面',
      'ゼイムス',
      'じえいむず',
      'ジェームス'
    ]);
  });

  it('drops empty patterns and surrounding whitespace', () => {
    expect(parseGlossaryAliases(' , Zeims,  ')).toEqual(['Zeims']);
  });
});
