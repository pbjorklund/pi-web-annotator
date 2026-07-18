import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = resolve(process.argv[2] ?? resolve(root, 'artwork/demo/pi-web-annotator-demo.mp4'));
const outputPath = resolve(process.argv[3] ?? resolve(root, 'artwork/demo/pi-web-annotator-demo.gif'));

const filter = [
  'fps=10,scale=800:-1:flags=lanczos,split[v0][v1]',
  '[v0]palettegen=max_colors=80:stats_mode=diff[p]',
  '[v1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
].join(';');

await new Promise((resolveRun, rejectRun) => {
  const child = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', inputPath,
    '-filter_complex', filter,
    outputPath,
  ], { stdio: 'inherit' });
  child.once('error', rejectRun);
  child.once('exit', (code) => {
    if (code === 0) resolveRun();
    else rejectRun(new Error(`ffmpeg exited with code ${code}`));
  });
});

const output = await stat(outputPath);
if (output.size < 100_000) throw new Error(`GIF output is unexpectedly small: ${output.size} bytes`);
console.log(`README demo: ${outputPath} (${output.size} bytes)`);
