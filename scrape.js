import fs from 'fs';
import { chromium } from 'playwright';

const MAX_RENT = 1900;
const TARGETS = ['Markham','Angus Glen','Unionville','North York','Richmond Hill','Vaughan'];

async function scrapeRealtor(page){
  // TODO: implement robust selector logic based on your final filters.
  // For now return empty; Apps Script will still merge Kijiji/Craigslist.
  return [];
}

async function scrapeCondos(page){
  // TODO: implement; same idea as above.
  return [];
}

function normalize(x, src){
  return {
    date_found: new Date().toISOString(),
    source: src,
    title: x.title||'',
    url: x.url||'',
    price: x.price||null,
    address: x.address||'',
    city: x.city||'',
    neighborhood: x.neighborhood||'',
    building: x.building||'',
    unit: x.unit||'',
    beds: x.beds||'',
    baths: x.baths||'',
    sqft: x.sqft||null,
    fee_month: x.fee_month||null,
    parking: !!x.parking,
    amenities: x.amenities||[],
    floor: x.floor||null,
    total_floors: x.total_floors||null,
    exposure: x.exposure||'',
    images: x.images||[],
    description: x.description||''
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const out = [];
  // Realtor + Condos (to be implemented with your final filters)
  out.push(...(await scrapeRealtor(page)).map(x=>normalize(x,'Realtor')));
  out.push(...(await scrapeCondos(page)).map(x=>normalize(x,'Condos')));

  // ensure folder
  fs.mkdirSync('exports', { recursive: true });
  fs.writeFileSync('exports/unified.json', JSON.stringify(out, null, 2));
  await browser.close();
})();
