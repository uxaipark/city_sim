// Local-only collector for http://127.0.0.1:5173/?profile=1
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
const results = [];
await mkdir('profiles', { recursive: true });
http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (['http://127.0.0.1:5173', 'http://127.0.0.1:5175'].includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/profile') { res.writeHead(404); res.end(); return; }
  try {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 1e6) throw new Error('Request too large'); }
    const report = JSON.parse(body);
    if (process.argv[3] && origin !== process.argv[3]) { res.writeHead(409); res.end('Different profiling origin'); return; }
    if (report.scenario === 'day-home-baseline') results.length = 0;
    results.push(report);
    await writeFile(process.argv[2] || 'profiles/latest.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ scenario: report.scenario, fps: report.fps, cpu: report.cpu, gpu: report.gpu, draws: report.draws, triangles: report.triangles }));
    res.end('ok');
  } catch (error) { res.writeHead(400); res.end(String(error)); }
}).listen(5174, '127.0.0.1', () => console.log('Profiling collector: http://127.0.0.1:5174'));
