/**
 * Generates the temporary imagery in assets/img/ph/.
 *
 * These are stand-ins: every one of them marks a slot where a real factory
 * photograph belongs. Replace the file, keep the filename, and the layout
 * stays exactly as it is (each slot has a fixed aspect ratio).
 *
 *   node scripts/make-placeholders.js
 *
 * Requires playwright + a Chromium build.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets', 'img', 'ph');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/* ---------------------------------------------------------------- motifs */
const M = {
  bubble: `
    <ellipse cx="500" cy="880" rx="300" ry="46"/>
    <path d="M330 880c-90-70-190-140-190-300V330c0-96 118-166 226-198"/>
    <path d="M670 880c90-70 190-140 190-300V330c0-96-118-166-226-198"/>
    <path d="M140 470h720" stroke-dasharray="10 26"/>
    <circle cx="430" cy="92" r="52"/><circle cx="570" cy="92" r="52"/>
    <path d="M180 690h640M180 610h640" opacity=".4"/>`,
  roll: `
    <circle cx="500" cy="500" r="400"/><circle cx="500" cy="500" r="320"/>
    <circle cx="500" cy="500" r="238"/><circle cx="500" cy="500" r="150"/>
    <circle cx="500" cy="500" r="66"/>
    <path d="M100 500h800M500 100v800" opacity=".25"/>`,
  rolls: `
    <ellipse cx="290" cy="250" rx="200" ry="72"/><path d="M90 250v420c0 40 90 72 200 72s200-32 200-72V250"/>
    <ellipse cx="740" cy="410" rx="180" ry="64"/><path d="M560 410v390c0 36 80 64 180 64s180-28 180-64V410"/>
    <ellipse cx="290" cy="670" rx="200" ry="72" opacity=".45"/>`,
  bags: `
    <path d="M170 330h330l40 560H130z"/><path d="M270 330v-70a65 65 0 0 1 130 0v70"/>
    <path d="M520 430h330l40 470H480z" opacity=".55"/><path d="M620 430v-56a64 64 0 0 1 128 0v56" opacity=".55"/>
    <path d="M200 520h250M550 610h230" opacity=".35"/>`,
  sack: `
    <path d="M230 300h520l60 620H170z"/>
    <path d="M230 300c40-90 120-140 260-140s220 50 260 140"/>
    <path d="M300 470h380M300 600h380M300 730h380" opacity=".3"/>`,
  food: `
    <path d="M150 380h700l-60 520H210z"/>
    <path d="M110 250l390-110 390 110v130H110z"/>
    <path d="M300 520v250M500 520v250M700 520v250" opacity=".3"/>`,
  gauge: `
    <rect x="60" y="400" width="880" height="200" rx="18"/>
    <path d="M200 400v90M340 400v130M480 400v90M620 400v130M760 400v90"/>
    <circle cx="500" cy="140" r="110"/><path d="M500 140V60M500 140l70 46"/>`,
  print: `
    <circle cx="500" cy="330" r="230"/><circle cx="500" cy="330" r="96"/>
    <rect x="90" y="620" width="820" height="270" rx="16"/>
    <path d="M170 700h300M170 780h180M600 700h240M600 780h150" opacity=".45"/>`,
  cut: `
    <path d="M60 460h880" stroke-dasharray="34 26"/>
    <path d="M300 120l160 300-160 300M700 120L540 420l160 300" opacity=".7"/>
    <rect x="120" y="760" width="760" height="140" rx="14" opacity=".5"/>`,
  pellets: `
    <g opacity=".85">
      <circle cx="230" cy="300" r="56"/><circle cx="380" cy="250" r="44"/><circle cx="520" cy="330" r="62"/>
      <circle cx="680" cy="260" r="48"/><circle cx="800" cy="360" r="54"/><circle cx="300" cy="470" r="50"/>
      <circle cx="470" cy="520" r="58"/><circle cx="640" cy="470" r="44"/><circle cx="790" cy="560" r="50"/>
      <circle cx="220" cy="650" r="46"/><circle cx="400" cy="700" r="56"/><circle cx="600" cy="660" r="48"/>
    </g>
    <path d="M60 830h880" opacity=".4"/>`,
  boxes: `
    <path d="M120 470l230-120 230 120-230 120z"/><path d="M120 470v250l230 120V590z"/><path d="M580 470v250L350 840V590z"/>
    <path d="M520 300l210-110 210 110-210 110z" opacity=".55"/><path d="M520 300v220l210 110V410z" opacity=".55"/>
    <path d="M940 300v220L730 630V410z" opacity=".55"/>`,
  machine: `
    <rect x="70" y="470" width="420" height="380" rx="16"/>
    <rect x="540" y="330" width="390" height="520" rx="16"/>
    <circle cx="280" cy="660" r="120"/><circle cx="280" cy="660" r="52"/>
    <circle cx="735" cy="540" r="90"/><circle cx="735" cy="540" r="34"/>
    <path d="M490 620h50M70 240h420v130H70z" opacity=".5"/>
    <path d="M600 750h270" opacity=".4"/>`,
  truck: `
    <rect x="70" y="330" width="500" height="330" rx="12"/>
    <path d="M570 440h190l140 140v80H570z"/>
    <circle cx="240" cy="720" r="86"/><circle cx="240" cy="720" r="34"/>
    <circle cx="740" cy="720" r="86"/><circle cx="740" cy="720" r="34"/>
    <path d="M150 420h330M150 500h200" opacity=".35"/>`,
  grid: `
    <path d="M0 250h1000M0 500h1000M0 750h1000M250 0v1000M500 0v1000M750 0v1000" opacity=".5"/>
    <circle cx="500" cy="500" r="260" opacity=".7"/>`
};

/* ----------------------------------------------------------------- slots */
const IMAGES = [
  { name: 'hero',            w: 1700, h: 1150, motif: 'bubble',  ar: 'خط نفخ الأفلام داخل المصنع', en: 'Blown film line' },
  { name: 'about',           w: 1000, h: 1300, motif: 'rolls',   ar: 'مخزون بكرات الأفلام',        en: 'Film roll stock' },

  { name: 'prod-shopping',   w: 900,  h: 900,  motif: 'bags',    ar: 'أكياس تسوق',                 en: 'Shopping bags' },
  { name: 'prod-refuse',     w: 900,  h: 900,  motif: 'sack',    ar: 'أكياس بلدية ونفايات',        en: 'Refuse sacks' },
  { name: 'prod-food',       w: 900,  h: 900,  motif: 'food',    ar: 'أكياس حفظ الأغذية',          en: 'Food storage bags' },
  { name: 'prod-film',       w: 900,  h: 900,  motif: 'roll',    ar: 'أفلام بلاستيكية بالبكرة',    en: 'Film on rolls' },
  { name: 'prod-custom',     w: 900,  h: 900,  motif: 'gauge',   ar: 'تصنيع حسب الطلب',            en: 'Made to spec' },
  { name: 'prod-print',      w: 900,  h: 900,  motif: 'print',   ar: 'الطباعة على الأكياس',        en: 'Bag printing' },

  { name: 'step-1',          w: 1100, h: 820,  motif: 'pellets', ar: 'الخامة والتجهيز',            en: 'Resin & prep' },
  { name: 'step-2',          w: 1100, h: 820,  motif: 'bubble',  ar: 'نفخ الفيلم',                 en: 'Film extrusion' },
  { name: 'step-3',          w: 1100, h: 820,  motif: 'print',   ar: 'الطباعة',                    en: 'Printing' },
  { name: 'step-4',          w: 1100, h: 820,  motif: 'cut',     ar: 'القص واللحام',               en: 'Cutting & sealing' },
  { name: 'step-5',          w: 1100, h: 820,  motif: 'gauge',   ar: 'الفحص والمطابقة',            en: 'Inspection' },
  { name: 'step-6',          w: 1100, h: 820,  motif: 'boxes',   ar: 'التعبئة والتسليم',           en: 'Packing & delivery' },

  { name: 'quality',         w: 1900, h: 950,  motif: 'machine', ar: 'داخل صالة الإنتاج',          en: 'Production floor' },

  { name: 'sector-retail',   w: 760,  h: 950,  motif: 'bags',    ar: 'التجزئة والمتاجر',           en: 'Retail' },
  { name: 'sector-food',     w: 760,  h: 950,  motif: 'food',    ar: 'الأغذية والمطاعم',           en: 'Food & restaurants' },
  { name: 'sector-wholesale',w: 760,  h: 950,  motif: 'boxes',   ar: 'الجملة والتوزيع',            en: 'Wholesale' },
  { name: 'sector-industry', w: 760,  h: 950,  motif: 'machine', ar: 'المصانع',                    en: 'Industry' },
  { name: 'sector-facility', w: 760,  h: 950,  motif: 'sack',    ar: 'المنشآت والنظافة',           en: 'Facilities' },
  { name: 'sector-logistics',w: 760,  h: 950,  motif: 'truck',   ar: 'اللوجستيات',                 en: 'Logistics' },

  { name: 'gallery-1',       w: 1200, h: 800,  motif: 'machine', ar: 'خط الإنتاج',                 en: 'Production line' },
  { name: 'gallery-2',       w: 1200, h: 800,  motif: 'roll',    ar: 'مخزون البكرات',              en: 'Roll stock' },
  { name: 'gallery-3',       w: 1200, h: 800,  motif: 'print',   ar: 'وحدة الطباعة',               en: 'Printing unit' },
  { name: 'gallery-4',       w: 1200, h: 800,  motif: 'boxes',   ar: 'التعبئة والشحن',             en: 'Packing & dispatch' }
];

/* ----------------------------------------------------------------- page */
function html(img, i) {
  const angle = 120 + (i * 37) % 130;          // vary the light direction
  const warm  = 0.10 + ((i * 13) % 9) / 100;   // vary the gold wash
  const zoom  = 1.00 + ((i * 7) % 13) / 100;   // gentle crop variation
  const shiftX = ((i * 29) % 13) - 6;          // keep the motif in frame
  const shiftY = ((i * 17) % 11) - 5;
  const motif = Math.round(Math.min(img.w, img.h) * 1.18);

  return `<!doctype html><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${img.w}px;height:${img.h}px;overflow:hidden}
  .ph{position:relative;width:${img.w}px;height:${img.h}px;
      background:
        radial-gradient(120% 90% at 78% 8%, rgba(226,199,149,${warm + .1}) 0%, transparent 58%),
        radial-gradient(90% 70% at 12% 96%, rgba(181,139,60,${warm}) 0%, transparent 60%),
        linear-gradient(${angle}deg, #2A2721 0%, #1B1915 45%, #100F0C 100%);
      font-family:"IBM Plex Sans Arabic","Noto Sans Arabic",system-ui,sans-serif;overflow:hidden}
  .motif{position:absolute;top:50%;left:50%;width:${motif}px;height:${motif}px;
         transform:translate(calc(-50% + ${shiftX}%), calc(-50% + ${shiftY}%)) scale(${zoom});
         opacity:.58}
  .rule{position:absolute;inset:0;opacity:.17;
        background-image:linear-gradient(rgba(226,199,149,.5) 1px,transparent 1px),
                         linear-gradient(90deg,rgba(226,199,149,.5) 1px,transparent 1px);
        background-size:${Math.round(img.w / 16)}px ${Math.round(img.w / 16)}px}
  /* Full-frame light beams: whatever crop a layout takes, it still has content */
  .beams{position:absolute;inset:-30%;
         background:
           linear-gradient(${angle - 42}deg, transparent 26%, rgba(226,199,149,.15) 33%, transparent 39%),
           linear-gradient(${angle - 42}deg, transparent 52%, rgba(226,199,149,.09) 57%, transparent 63%),
           linear-gradient(${angle - 42}deg, transparent 71%, rgba(181,139,60,.14) 78%, transparent 85%)}
  .vig{position:absolute;inset:0;
       background:radial-gradient(125% 105% at 50% 42%, transparent 42%, rgba(8,8,6,.62) 100%)}
  .grain{position:absolute;inset:0;opacity:.5;mix-blend-mode:overlay;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='4'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E")}
  .tag{position:absolute;left:${Math.round(img.w * .045)}px;bottom:${Math.round(img.w * .045)}px;
       display:flex;align-items:center;gap:${Math.round(img.w / 90)}px;
       padding:${Math.round(img.w / 80)}px ${Math.round(img.w / 48)}px;
       border:1px solid rgba(226,199,149,.34);border-radius:999px;
       background:rgba(16,15,12,.5);backdrop-filter:blur(6px);
       color:#E9E2D3;font-size:${Math.round(Math.max(13, img.w / 52))}px;white-space:nowrap}
  .dot{width:${Math.round(img.w / 130)}px;height:${Math.round(img.w / 130)}px;border-radius:50%;
       background:#C9A15A;flex:none}
  .en{color:#A79E8B;font-family:"IBM Plex Mono",ui-monospace,monospace;
      font-size:${Math.round(Math.max(10, img.w / 74))}px;letter-spacing:.12em;text-transform:uppercase}
</style>
<div class="ph">
  <div class="rule"></div>
  <div class="beams"></div>
  <svg class="motif" viewBox="0 0 1000 1000" fill="none" stroke="#E2C795" stroke-width="6"
       stroke-linecap="round" stroke-linejoin="round">${M[img.motif]}</svg>
  <div class="vig"></div>
  <div class="grain"></div>
  <div class="tag">
    <span class="dot"></span>
    <span>${img.ar}</span>
    <span class="en">${img.en} · placeholder</span>
  </div>
</div>`;
}

/* ------------------------------------------------------------------ run */
(async () => {
  const { chromium } = require('playwright');
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME });
  for (let i = 0; i < IMAGES.length; i++) {
    const img = IMAGES[i];
    const page = await browser.newPage({ viewport: { width: img.w, height: img.h } });
    await page.setContent(html(img, i), { waitUntil: 'load' });
    await page.waitForTimeout(120);
    await page.screenshot({
      path: path.join(OUT, img.name + '.jpg'),
      type: 'jpeg',
      quality: 80
    });
    await page.close();
    process.stdout.write('.');
  }
  await browser.close();
  console.log('\n' + IMAGES.length + ' placeholders written to assets/img/ph/');
})();
