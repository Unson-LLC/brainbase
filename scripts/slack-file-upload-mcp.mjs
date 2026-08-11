#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';

const token = process.env.SLACK_MCP_XOXP_TOKEN;
const host = process.env.SLACK_MCP_HOST || '127.0.0.1';
const port = Number(process.env.SLACK_MCP_PORT || '13085');
const maxBytes = Number(process.env.SLACK_MCP_UPLOAD_MAX_BYTES || 10 * 1024 * 1024);
const allowedChannels = new Set((process.env.SLACK_MCP_UPLOAD_CHANNELS || '').split(',').filter(Boolean));
const allowedRoots = (process.env.SLACK_MCP_UPLOAD_ROOTS || '/tmp').split(',').map((root) => resolve(root));

if (!token) throw new Error('SLACK_MCP_XOXP_TOKEN is required');

function ensureAllowedPath(filePath) {
  const absolute = resolve(filePath);
  if (!allowedRoots.some((root) => absolute === root || absolute.startsWith(`${root}/`))) {
    throw new Error(`file_path must be under an allowed root: ${allowedRoots.join(', ')}`);
  }
  return absolute;
}

async function slackApi(method, body) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    const scopeHint = result.needed ? ` (needed: ${result.needed}; provided: ${result.provided || 'none'})` : '';
    throw new Error(`${method} failed: ${result.error || response.status}${scopeHint}`);
  }
  return result;
}

export async function uploadFile({ channel_id, file_path, title, initial_comment }) {
  if (allowedChannels.size && !allowedChannels.has(channel_id)) throw new Error('channel_id is not allowed');
  const absolute = ensureAllowedPath(file_path);
  const metadata = await stat(absolute);
  if (!metadata.isFile()) throw new Error('file_path is not a regular file');
  if (metadata.size > maxBytes) throw new Error(`file exceeds ${maxBytes} bytes`);
  const data = await readFile(absolute);
  const filename = basename(absolute);
  const upload = await slackApi('files.getUploadURLExternal', { filename, length: String(data.length) });
  const uploaded = await fetch(upload.upload_url, { method: 'POST', body: data });
  if (!uploaded.ok) throw new Error(`file transfer failed: HTTP ${uploaded.status}`);
  const completed = await slackApi('files.completeUploadExternal', {
    files: JSON.stringify([{ id: upload.file_id, title: title || filename }]),
    channel_id,
    ...(initial_comment ? { initial_comment } : {}),
  });
  const file = completed.files?.[0] || {};
  return { id: file.id, name: file.name || filename, permalink: file.permalink, channel_id };
}

function createServer() {
  const server = new McpServer({ name: 'brainbase-slack-file-upload', version: '1.0.0' });
  server.registerTool('files_upload_v2', {
    description: 'Upload a local file to an explicitly allowed Slack channel.',
    inputSchema: {
      channel_id: z.string().min(1),
      file_path: z.string().min(1),
      title: z.string().optional(),
      initial_comment: z.string().optional(),
    },
  }, async (input) => {
    try {
      const result = await uploadFile(input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  return server;
}

const app = createMcpExpressApp({ host });
app.post('/mcp', async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
  } finally {
    res.on('close', () => { transport.close(); server.close(); });
  }
});
app.get('/health', (_req, res) => res.json({ ok: true, workspace: 'T0882T8N9UH' }));
app.all('/mcp', (_req, res) => res.status(405).end());

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, host, (error) => {
    if (error) throw error;
    process.stderr.write(`Slack file upload MCP listening on http://${host}:${port}/mcp\n`);
  });
}
