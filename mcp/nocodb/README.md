# NocoDB MCP Server

NocoDB database access via Model Context Protocol for Brainbase.

## Features

- List records from NocoDB tables
- Get single record by ID
- Create new records
- Update existing records
- Delete records
- Airtable-compatible interface

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Add to `/Users/ksato/workspace/.env`:

```bash
NOCODB_URL=https://noco.unson.jp
NOCODB_TOKEN=your_api_token
```

### 3. Build

```bash
npm run build
```

### 4. Add to Claude Code settings

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "nocodb": {
      "command": "node",
      "args": ["/Users/ksato/workspace/tools/nocodb-mcp/build/index.js"],
      "env": {
        "NOCODB_URL": "${NOCODB_URL}",
        "NOCODB_TOKEN": "${NOCODB_TOKEN}"
      }
    }
  }
}
```

## Development

```bash
# Watch mode
npm run dev

# Test
npm run test

# Inspector (debug)
npm run inspector
```

## Tools

### nocodb_list_records

List records from a NocoDB table.

**Parameters:**
- `baseId` (string): Airtable base ID
- `tableName` (string): Table name
- `limit` (number, optional): Max records to return (default: 100)
- `offset` (number, optional): Offset for pagination (default: 0)
- `where` (string, optional): Filter condition
- `sort` (string, optional): Sort order
- `fields` (string[], optional): Fields to return

### nocodb_get_record

Get a single record by ID.

**Parameters:**
- `baseId` (string): Airtable base ID
- `tableName` (string): Table name
- `recordId` (string): Record ID

### nocodb_create_record

Create a new record.

**Parameters:**
- `baseId` (string): Airtable base ID
- `tableName` (string): Table name
- `fields` (object): Record fields

### nocodb_update_record

Update an existing record.

**Parameters:**
- `baseId` (string): Airtable base ID
- `tableName` (string): Table name
- `recordId` (string): Record ID
- `fields` (object): Updated fields

### nocodb_delete_record

Delete a record.

**Parameters:**
- `baseId` (string): Airtable base ID
- `tableName` (string): Table name
- `recordId` (string): Record ID

## License

MIT
