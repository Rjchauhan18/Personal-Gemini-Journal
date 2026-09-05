import fs from 'fs';
let content = fs.readFileSync('server.ts', 'utf8');

const endpointStartStr = '  app.post("/api/generate-image", authenticateToken, async (req: express.Request, res: express.Response) => {';
const endpointStart = content.indexOf(endpointStartStr);

if (endpointStart !== -1) {
  const nextEndpointStr = '  app.post("/api/reflect-agent", authenticateToken, async (req: express.Request, res: express.Response) => {';
  const nextEndpoint = content.indexOf(nextEndpointStr, endpointStart);
  
  if (nextEndpoint !== -1) {
    content = content.slice(0, endpointStart) + content.slice(nextEndpoint);
    fs.writeFileSync('server.ts', content);
    console.log("Endpoint removed successfully");
  } else {
    console.log("Next endpoint not found");
  }
} else {
  console.log("Endpoint not found");
}
