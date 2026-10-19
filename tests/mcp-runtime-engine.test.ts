import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createLocalMcpServer,
  runLocalMcpServer,
  type LocalMcpRuntimeTool
} from '../src/mcp-runtime.js';

const getOntology: LocalMcpRuntimeTool = {
  definition: {
    name: 'get_ontology',
    description: 'Return the host supplied ontology snapshot.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  handler: async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ontologyVersion: '2.0.0', entities: [] }) }]
  })
};

const echo: LocalMcpRuntimeTool = {
  definition: {
    name: 'echo',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false
    }
  },
  handler: async (arguments_) => ({
    content: [{ type: 'text', text: String(arguments_.value) }]
  })
};

describe('local MCP runtime engine', () => {
  it('supports SDK initialize, tools/list, tools/call, and ping over an injected transport', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'local-runtime-contract-test', version: '1.0.0' });
    const listed: string[][] = [];
    const runtime = await runLocalMcpServer({
      name: 'brainbase-local-runtime',
      version: '1.0.0',
      tools: [getOntology, echo],
      onListTools: (tools) => listed.push(tools.map((tool) => tool.name)),
      transport: serverTransport
    });

    await client.connect(clientTransport);
    try {
      await expect(client.ping()).resolves.toBeDefined();
      await expect(client.listTools()).resolves.toMatchObject({
        tools: [
          { name: 'get_ontology' },
          { name: 'echo' }
        ]
      });
      expect(listed).toEqual([['get_ontology', 'echo']]);
      await expect(client.callTool({ name: 'get_ontology', arguments: {} })).resolves.toMatchObject({
        content: [{ type: 'text' }]
      });
      await expect(client.callTool({ name: 'echo', arguments: { value: 'contract-ok' } })).resolves.toMatchObject({
        content: [{ type: 'text', text: 'contract-ok' }]
      });
    } finally {
      await client.close();
      await runtime.close();
      await runtime.close();
    }
  });

  it('returns an MCP tool error for an unregistered tool without invoking a host callback', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'local-runtime-negative-test', version: '1.0.0' });
    const server = createLocalMcpServer({
      name: 'brainbase-local-runtime',
      version: '1.0.0',
      tools: [getOntology]
    });

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await expect(client.callTool({ name: 'foreign_scope_tool', arguments: {} })).resolves.toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'Unknown tool: foreign_scope_tool' }]
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
