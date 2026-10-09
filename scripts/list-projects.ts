// Read-only onboarding; reuse the CLI/MCP trusted config and server identity checks.
import {readConfig,environmentClient} from '../packages/local-context/src/binding.ts';
import {safeError,ClientError} from '../packages/client/src/client.ts';
try {
  if(process.argv.includes('--help')) {
    console.log('Set GRAYBOX_CLIENT_CONFIG to your absolute private client.json path, then run node runtime/list-projects.mjs. Reads authorized projects only.');
  } else {
    if(!process.env.GRAYBOX_CLIENT_CONFIG)throw new ClientError('CONFIG_INVALID','Set GRAYBOX_CLIENT_CONFIG to your absolute private config path');
    const {config}=await readConfig();
    const result=[];
    for(const e of config.environments) {
      const {api,workspace_id}=await environmentClient(e.environment_id);
      const projects=(await api.projects()).filter(p=>p.workspace_id===workspace_id).map(p=>({id:p.id,name:p.name,workspace_id:p.workspace_id}));
      result.push({environment_id:e.environment_id,workspace_id,projects});
    }
    console.log(JSON.stringify({data:result},null,2));
  }
} catch(error) {
  console.error(JSON.stringify(safeError(error)));process.exitCode=1;
}
