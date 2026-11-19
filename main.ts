// Token Radar entrypoint: read one sealed snapshot, score its pre-token universe, and publish
// a board, a no-network research terminal, screenshots, and the canonical dossier.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  const eq = process.argv.find((x) => x.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : fallback;
}
function copyFiles(from: string, to: string): string[] {
  mkdirSync(to, { recursive: true });
  if (!existsSync(from)) return [];
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name)); names.push(name);
  }
  return names.sort();
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
const outputDir = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
if (!existsSync(inputFile)) throw new Error(`No snapshot at ${inputFile}`);
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue) throw new Error(`Model produced an invalid board: ${issue}`);

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));
const dashboardSource = join(here, 'dashboard');
const dashboardOut = join(outputDir, 'dashboard');
const dashboardFiles = copyFiles(dashboardSource, dashboardOut);
// A root mirror makes the artifact convenient to open directly while the gated copy remains dashboard/.
copyFiles(dashboardSource, outputDir);
const rootIndex = join(outputDir, 'index.html');
if (existsSync(rootIndex)) writeFileSync(rootIndex, readFileSync(rootIndex, 'utf8').replace('src="../data.js"', 'src="data.js"'));
const shotNames = copyFiles(join(here, 'screenshots'), join(outputDir, 'screenshots'));
if (dashboardFiles.length < 3) throw new Error('dashboard must contain index.html, app.css and app.js');
if (shotNames.length < 3) throw new Error('screenshots must contain the board, detail and filtered views');
writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
}));
process.stdout.write(`token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist, ${board.length} rows; dashboard ${dashboardFiles.length} files; screenshots ${shotNames.length}\n`);
