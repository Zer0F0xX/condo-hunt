import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const BROWSER_CACHE = process.env.PLAYWRIGHT_BROWSERS_PATH || path.resolve('.playwright-browsers');
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSER_CACHE;

const DEFAULT_MAX_RENT = 1900;
const DEFAULT_REGIONS = [
  'Markham',
  'Angus Glen',
  'Unionville',
  'North York',
  'Richmond Hill',
  'Vaughan'
];

const MAX_RENT = sanitizeMaxRent(process.env.MAX_RENT);
const REGIONS = parseRegions(process.env.REGIONS);

function sanitizeMaxRent(value) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RENT;
}

function parseRegions(value) {
  if (!value) return DEFAULT_REGIONS;
  return value
    .split(/[;,]/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function decodeHTML(value = '') {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value = '') {
  return decodeHTML(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeHTML(match[1]).trim() : '';
}

function extractEnclosureUrl(block) {
  const match = block.match(/<enclosure[^>]*url="([^"]+)"[^>]*>/i);
  if (match) return match[1];
  const media = block.match(/<media:content[^>]*url="([^"]+)"[^>]*>/i);
  return media ? media[1] : '';
}

function extractPrice(text = '') {
  const match = text.replace(/,/g, '').match(/\$?(\d{3,5})/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function dedupeByUrl(rows) {
  const seen = new Map();
  for (const row of rows) {
    const key = row.url || row.title;
    if (!key) continue;
    if (!seen.has(key)) {
      seen.set(key, row);
    }
  }
  return Array.from(seen.values());
}

function normalize(entry, source) {
  const amenities = Array.isArray(entry.amenities)
    ? entry.amenities
    : String(entry.amenities ?? '')
        .split(/[;,]/)
        .map((a) => a.trim())
        .filter(Boolean);

  const images = Array.isArray(entry.images)
    ? entry.images.filter(Boolean)
    : [entry.images].filter(Boolean);

  const isoDate = (() => {
    const raw = entry.date_found ?? entry.pubDate ?? entry.date;
    const parsed = raw ? new Date(raw) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  })();

  return {
    date_found: isoDate,
    source,
    title: entry.title ?? '',
    url: entry.url ?? '',
    price: entry.price ?? null,
    address: entry.address ?? '',
    city: entry.city ?? '',
    neighborhood: entry.neighborhood ?? '',
    building: entry.building ?? '',
    unit: entry.unit ?? '',
    beds: entry.beds ?? '',
    baths: entry.baths ?? '',
    sqft: entry.sqft ?? null,
    fee_month: entry.fee_month ?? null,
    parking: Boolean(entry.parking ?? false),
    amenities,
    floor: entry.floor ?? null,
    total_floors: entry.total_floors ?? null,
    exposure: entry.exposure ?? '',
    images,
    description: entry.description ?? '',
    score: entry.score ?? null,
    notes: entry.notes ?? ''
  };
}

async function fetchRSS(url, label) {
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
        'accept-language': 'en-CA,en;q=0.9'
      },
      redirect: 'follow'
    });
    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
    return await res.text();
  } catch (error) {
    console.error(`[rss:${label}] ${error.message}`);
    return '';
  }
}

function parseRSSItems(xml) {
  if (!xml) return [];
  const items = [];
  const regex = /<item[\s\S]*?<\/item>/gi;
  const matches = xml.match(regex) ?? [];
  for (const block of matches) {
    items.push({
      block,
      title: extractTag(block, 'title'),
      link: extractTag(block, 'link'),
      description: stripTags(extractTag(block, 'description')),
      rawDescription: extractTag(block, 'description'),
      pubDate: extractTag(block, 'pubDate'),
      enclosure: extractEnclosureUrl(block)
    });
  }
  return items;
}

async function kijijiAdapter(maxRent, regions) {
  const base = 'https://www.kijiji.ca/rss-srp-apartments-condos/gta-greater-toronto-area/1+den__1+1/k0c37l1700272';
  const aggregate = [];

  for (const region of regions) {
    const url = `${base}?ad=offering&price=0__${maxRent}&keywords=${encodeURIComponent(region)}`;
    const xml = await fetchRSS(url, `kijiji:${region}`);
    const items = parseRSSItems(xml);
    for (const item of items) {
      const description = item.description;
      const price = extractPrice(description) ?? extractPrice(item.title);
      aggregate.push({
        title: item.title,
        url: item.link,
        price,
        address: '',
        city: region,
        neighborhood: region,
        building: '',
        unit: '',
        beds: '',
        baths: '',
        sqft: null,
        fee_month: null,
        parking: /parking/i.test(description),
        amenities: [],
        floor: null,
        total_floors: null,
        exposure: '',
        images: item.enclosure ? [item.enclosure] : [],
        description,
        date_found: item.pubDate,
        score: null,
        notes: ''
      });
    }
  }

  return aggregate;
}

async function craigslistAdapter(maxRent, regions) {
  const url = `https://toronto.craigslist.org/search/apa?availabilityMode=0&format=rss&max_price=${maxRent}&query=${encodeURIComponent('1+den parking')}`;
  const xml = await fetchRSS(url, 'craigslist');
  const items = parseRSSItems(xml);
  const aggregate = [];

  for (const item of items) {
    const description = item.description;
    const title = item.title;
    const price = extractPrice(title) ?? extractPrice(description);
    const images = [];
    if (item.enclosure) images.push(item.enclosure);
    const matchedRegion = regions.find((region) =>
      new RegExp(region, 'i').test(title) || new RegExp(region, 'i').test(description)
    );

    aggregate.push({
      title,
      url: item.link,
      price,
      address: '',
      city: matchedRegion ?? 'GTA',
      neighborhood: matchedRegion ?? '',
      building: '',
      unit: '',
      beds: '',
      baths: '',
      sqft: null,
      fee_month: null,
      parking: /parking/i.test(description),
      amenities: [],
      floor: null,
      total_floors: null,
      exposure: '',
      images,
      description,
      date_found: item.pubDate,
      score: null,
      notes: ''
    });
  }

  return aggregate;
}

async function realtorAdapter(page, maxRent, regions) {
  // TODO: Implement Realtor.ca scraping with filters: rent <= maxRent, 1 bed + den, parking, York Region.
  // Suggested approach: search for listings, wait for cards, extract title, price, address, city, link, image, and floor info.
  void page;
  void maxRent;
  void regions;
  return [];
}

async function condosAdapter(page, maxRent, regions) {
  // TODO: Implement condos listings scraping with infinite scroll handling and robust selectors.
  // Use page.evaluate with scrollBy loop and gather card details (title, price, address, beds, baths, photos).
  void page;
  void maxRent;
  void regions;
  return [];
}

async function main() {
  let browser;
  let page;
  const collected = [];

  const demoSeed = [
    {
      date_found: '2025-01-01T09:00:00.000Z',
      source: 'DemoSeed',
      title: 'Downtown Markham 1+Den with Parking',
      url: 'https://example.com/listings/downtown-markham-1plusden',
      price: 1890,
      address: '15 Water Walk Dr',
      city: 'Markham',
      neighborhood: 'Downtown Markham',
      building: 'Water Walk',
      unit: '1208',
      beds: '1+1',
      baths: '1',
      sqft: 640,
      fee_month: null,
      parking: true,
      amenities: ['gym', 'pool', 'balcony'],
      floor: 12,
      total_floors: 25,
      exposure: 'S',
      images: ['https://picsum.photos/seed/downtownmarkham/800/500'],
      description: 'Sunlit 1+den with parking and balcony overlooking community centre.',
      score: null,
      notes: ''
    },
    {
      date_found: '2025-01-01T09:05:00.000Z',
      source: 'DemoSeed',
      title: 'Angus Glen Townhome 1+Den Garage',
      url: 'https://example.com/listings/angus-glen-townhome',
      price: 1850,
      address: '10000 Kennedy Rd',
      city: 'Markham',
      neighborhood: 'Angus Glen',
      building: 'Village at Angus Glen',
      unit: '',
      beds: '1+1',
      baths: '1',
      sqft: 710,
      fee_month: null,
      parking: true,
      amenities: ['balcony', 'garage'],
      floor: 2,
      total_floors: 3,
      exposure: 'E',
      images: ['https://picsum.photos/seed/angusglen/800/500'],
      description: 'Townhome loft with garage parking and quiet street steps to golf club.',
      score: null,
      notes: ''
    },
    {
      date_found: '2025-01-01T09:10:00.000Z',
      source: 'DemoSeed',
      title: 'North York 1+Den near Finch Subway',
      url: 'https://example.com/listings/north-york-1plusden',
      price: 1795,
      address: '15 Greenview Ave',
      city: 'Toronto',
      neighborhood: 'North York',
      building: 'Meridian',
      unit: '',
      beds: '1+1',
      baths: '1',
      sqft: 600,
      fee_month: null,
      parking: true,
      amenities: ['gym', 'pool', 'concierge'],
      floor: 20,
      total_floors: 31,
      exposure: 'SE',
      images: ['https://picsum.photos/seed/northyork/800/500'],
      description: 'Bright unit with full den and steps to Finch TTC hub.',
      score: null,
      notes: ''
    }
  ];

  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  } catch (error) {
    console.error(`[playwright] launch failed: ${error.message}`);
  }

  const adapters = [
    {
      name: 'Kijiji',
      run: () => kijijiAdapter(MAX_RENT, REGIONS)
    },
    {
      name: 'Craigslist',
      run: () => craigslistAdapter(MAX_RENT, REGIONS)
    },
    {
      name: 'Realtor',
      run: () => (page ? realtorAdapter(page, MAX_RENT, REGIONS) : [])
    },
    {
      name: 'Condos',
      run: () => (page ? condosAdapter(page, MAX_RENT, REGIONS) : [])
    }
  ];

  for (const adapter of adapters) {
    try {
      const rawRows = await adapter.run();
      const normalized = rawRows.map((row) => normalize(row, adapter.name));
      collected.push(...normalized);
      console.log(`[adapter:${adapter.name.toLowerCase()}] collected ${normalized.length}`);
    } catch (error) {
      console.error(`[adapter:${adapter.name.toLowerCase()}] failed: ${error.message}`);
    }
  }

  try {
    if (page) await page.close();
    if (browser) await browser.close();
  } catch (error) {
    console.error(`[playwright] shutdown error: ${error.message}`);
  }

  const deduped = dedupeByUrl(collected);
  if (deduped.length === 0) {
    console.warn('[summary] adapters empty; falling back to demo seed data.');
    deduped.push(...demoSeed.map((row) => normalize(row, row.source || 'DemoSeed')));
  }

  const counts = deduped.reduce((acc, row) => {
    acc[row.source] = (acc[row.source] ?? 0) + 1;
    return acc;
  }, {});

  const countsLine = Object.entries(counts)
    .map(([source, count]) => `${source}=${count}`)
    .join(', ');
  console.log(`[summary] counts by source -> ${countsLine || 'none'}`);

  const outputDir = path.resolve('exports');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'unified.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(deduped, null, 2)}\n`, 'utf8');
  console.log(`[write] ${outputPath}`);

  if (deduped.length > 0) {
    const sample = deduped.slice(0, 2).map((item) => item.title).filter(Boolean);
    if (sample.length > 0) {
      console.log(`[sample] first titles -> ${sample.join(' | ')}`);
    }
  }
}

main().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exitCode = 1;
});
