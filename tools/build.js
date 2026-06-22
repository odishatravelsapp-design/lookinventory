// Production build: bundle + obfuscate JS into a single hardened file, minify the
// service worker, and emit a clean ./dist for deployment (Vercel `outputDirectory`).
//
//   npm run build   ->  ./dist
//
// NOTE (honest): this hardens the client (no console, anti-debug, obfuscated logic)
// and deters copying — but browser code is never truly uncrackable. Keep secrets server-side.
const fs = require('fs');
const path = require('path');
const JO = require('javascript-obfuscator');
const { minify } = require('terser');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, c) => { fs.mkdirSync(path.dirname(path.join(dist, p)), { recursive: true }); fs.writeFileSync(path.join(dist, p), c); };

// Load order matters — globals are defined before app.js uses them.
const JS_ORDER = ['config', 'flags', 'i18n', 'db', 'scanner', 'sync', 'btprint', 'barcode', 'cloud', 'license', 'app'];

(async () => {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  // 1) Concatenate + obfuscate the app code into one bundle.
  const bundleSrc = JS_ORDER.map((n) => '/* ' + n + ' */\n' + read('js/' + n + '.js')).join('\n;\n');
  const obf = JO.obfuscate(bundleSrc, {
    compact: true,
    controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.6,
    deadCodeInjection: true, deadCodeInjectionThreshold: 0.3,
    disableConsoleOutput: true,           // no console.* in prod
    debugProtection: true,                // resists DevTools stepping
    selfDefending: true,                  // breaks if reformatted/tampered
    identifierNamesGenerator: 'hexadecimal',
    numbersToExpressions: true,
    simplify: true,
    splitStrings: true, splitStringsChunkLength: 8,
    stringArray: true, stringArrayEncoding: ['base64'], stringArrayThreshold: 0.75,
    transformObjectKeys: false,           // MUST stay false (i18n/flags look up keys by string)
    renameProperties: false               // MUST stay false (same reason)
  });
  write('js/app.bundle.js', obf.getObfuscatedCode());

  // 2) Service worker: point its cache list at the single bundle, then minify.
  let sw = read('sw.js')
    .replace(/\s*'\.\/js\/[a-z]+\.js',/g, '')                       // drop individual js entries
    .replace("'./css/styles.css',", "'./css/styles.css',\n  './js/app.bundle.js',");
  write('sw.js', (await minify(sw)).code);

  // 3) index.html: replace the 10 dev <script> tags with the one bundle.
  let html = read('index.html').replace(
    /<script src="js\/config\.js"><\/script>[\s\S]*?<script src="js\/app\.js"><\/script>/,
    '<script src="js/app.bundle.js"></script>'
  );
  write('index.html', html);

  // 4) Static assets.
  write('css/styles.css', read('css/styles.css'));
  write('manifest.webmanifest', read('manifest.webmanifest'));
  for (const f of ['icon.svg', 'icon-192.png', 'icon-512.png']) {
    fs.mkdirSync(path.join(dist, 'icons'), { recursive: true });
    fs.copyFileSync(path.join(root, 'icons', f), path.join(dist, 'icons', f));
  }

  const kb = (fs.statSync(path.join(dist, 'js/app.bundle.js')).size / 1024).toFixed(0);
  console.log('Built ./dist  (app.bundle.js = ' + kb + ' KB, obfuscated + console/debug disabled)');
})();
