import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

async function importExport(manifest: { exports: Record<string, { import: string }> }, subpath: string) {
  return import(pathToFileURL(path.join(root, manifest.exports[subpath].import)).href);
}

describe('Graphの検索コアの公開契約', () => {
  it('束の検証・ダイジェスト・検索、関係ID、埋め込みの生成をpackageの出口から取り込める', async () => {
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

    expect(manifest.exports).toMatchObject({
      './portable-graph': {
        types: './dist/portable-graph.d.ts',
        import: './dist/portable-graph.js',
      },
      './canonical-graph': {
        types: './dist/canonical-graph.d.ts',
        import: './dist/canonical-graph.js',
      },
      './embedding-provider': {
        types: './dist/embedding-provider.d.ts',
        import: './dist/embedding-provider.js',
      },
    });

    const portableGraph = await importExport(manifest, './portable-graph');
    for (const name of ['validatePortableGraph', 'portableGraphDigest', 'retrievePortableGraph']) {
      expect(typeof portableGraph[name]).toBe('function');
    }

    // 組織側は関係IDを保存して照合するため、IDの作り方は版をまたいで変えない。
    const canonicalGraph = await importExport(manifest, './canonical-graph');
    expect(canonicalGraph.canonicalEdgeId({ fromId: 'person-a', relation: 'participates_in', toId: 'project-a' }))
      .toBe('edge-d838ad640fc0855b6aac47a8');

    const embeddingProvider = await importExport(manifest, './embedding-provider');
    expect(embeddingProvider.createEmbeddingProviderFromEnv({})).toBeUndefined();
    expect(() => embeddingProvider.createEmbeddingProviderFromEnv({ BRAINBASE_EMBEDDING_URL: 'https://embeddings.example/v1/embeddings' }))
      .toThrow(embeddingProvider.EmbeddingProviderConfigError);
  });
});
