import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { registerTools } from './tools.ts';
import { safeError } from '../../../packages/client/src/client.ts';
export function createMcpServer(){const server=new McpServer({name:'graybox',version:'0.3.0'});registerTools(server);return server;}
export async function serve(){const server=createMcpServer();await server.connect(new StdioServerTransport());return server;}
if(process.argv[1]&&/[/\\]server\.(ts|js|mjs)$/.test(process.argv[1])&&import.meta.url===pathToFileURL(process.argv[1]).href)serve().catch(error=>{process.stderr.write(JSON.stringify(safeError(error))+'\n');process.exitCode=1;});
