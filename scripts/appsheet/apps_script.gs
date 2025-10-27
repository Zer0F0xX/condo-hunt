/**
 * Condo Hunt Apps Script harness
 * 1. Update GITHUB_UNIFIED_JSON once the GitHub Raw URL is ready.
 * 2. Populate BOT_TOKEN and CHAT_ID for Telegram alerts.
 * 3. runHunt() pulls listings into UNIFIED, scores them, and pings Telegram.
 */
const GITHUB_UNIFIED_JSON = 'PASTE-RAW-URL-HERE';
const BOT_TOKEN = 'PASTE_TELEGRAM_BOT_TOKEN';
const CHAT_ID = 'PASTE_TELEGRAM_CHAT_ID';

const CONFIG_SHEET = 'CONFIG';
const UNIFIED_SHEET = 'UNIFIED';
const UNIFIED_HEADERS = [
  'date_found',
  'source',
  'title',
  'url',
  'price',
  'address',
  'city',
  'neighborhood',
  'building',
  'unit',
  'beds',
  'baths',
  'sqft',
  'fee_month',
  'parking',
  'amenities',
  'floor',
  'total_floors',
  'exposure',
  'images',
  'score',
  'notes'
];

function runHunt() {
  const config = loadConfig();
  const githubListings = fetchGithubListings();
  const fallbackListings = githubListings.length ? [] : fetchFallbackListings(config);
  const merged = dedupeListings(githubListings.concat(fallbackListings));
  const scored = merged.map((listing) => ({ ...listing, score: scoreListing(listing, config) }));

  writeUnifiedSheet(scored);
  maybePingTelegram(scored, config);
}

function loadConfig() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG_SHEET);
  if (!sheet) {
    throw new Error('CONFIG sheet missing.');
  }
  const values = sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues();
  const config = {};
  values.forEach(([key, value]) => {
    if (!key) return;
    config[String(key).trim()] = typeof value === 'string' ? value.trim() : value;
  });
  return config;
}

function fetchGithubListings() {
  if (!GITHUB_UNIFIED_JSON || GITHUB_UNIFIED_JSON.includes('PASTE-RAW-URL-HERE')) {
    Logger.log('GITHUB_UNIFIED_JSON not set yet. Skipping GitHub fetch.');
    return [];
  }
  try {
    const response = UrlFetchApp.fetch(GITHUB_UNIFIED_JSON, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'condo-hunt-apps-script'
      }
    });
    if (response.getResponseCode() !== 200) {
      Logger.log(`GitHub fetch failed: ${response.getResponseCode()}`);
      return [];
    }
    const text = response.getContentText();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    Logger.log(`GitHub fetch error: ${error.message}`);
    return [];
  }
}

function fetchFallbackListings(config) {
  const listings = [];
  const maxRent = Number(config.MAX_RENT || 1900);
  const regions = splitConfigList(config.REGIONS, ['Markham', 'Angus Glen', 'Unionville', 'North York', 'Richmond Hill', 'Vaughan']);
  listings.push(...fetchKijijiFeed(maxRent, regions));
  listings.push(...fetchCraigslistFeed(maxRent, regions));
  return listings;
}

function fetchKijijiFeed(maxRent, regions) {
  const base = 'https://www.kijiji.ca/rss-srp-apartments-condos/gta-greater-toronto-area/1+den__1+1/k0c37l1700272';
  const listings = [];
  regions.forEach((region) => {
    const url = `${base}?ad=offering&price=0__${maxRent}&keywords=${encodeURIComponent(region)}`;
    const xml = safeFetchXml(url, `kijiji:${region}`);
    const items = parseRssItems(xml);
    items.forEach((item) => {
      const description = item.description;
      listings.push({
        date_found: item.pubDate,
        source: 'Kijiji',
        title: item.title,
        url: item.link,
        price: extractNumeric(item.title) || extractNumeric(description),
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
        score: null,
        notes: ''
      });
    });
    Utilities.sleep(250);
  });
  return listings;
}

function fetchCraigslistFeed(maxRent, regions) {
  const url = `https://toronto.craigslist.org/search/apa?availabilityMode=0&format=rss&max_price=${maxRent}&query=${encodeURIComponent('1+den parking')}`;
  const xml = safeFetchXml(url, 'craigslist');
  const items = parseRssItems(xml);
  return items.map((item) => {
    const description = item.description;
    const matchedRegion = regions.find((region) =>
      new RegExp(region, 'i').test(item.title) || new RegExp(region, 'i').test(description)
    );
    return {
      date_found: item.pubDate,
      source: 'Craigslist',
      title: item.title,
      url: item.link,
      price: extractNumeric(item.title) || extractNumeric(description),
      address: '',
      city: matchedRegion || 'GTA',
      neighborhood: matchedRegion || '',
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
      score: null,
      notes: ''
    };
  });
}

function writeUnifiedSheet(listings) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(UNIFIED_SHEET);
  if (!sheet) {
    throw new Error('UNIFIED sheet missing.');
  }

  sheet.getRange(1, 1, 1, UNIFIED_HEADERS.length).setValues([UNIFIED_HEADERS]);
  const existingRows = Math.max(sheet.getLastRow() - 1, 0);
  if (existingRows > 0) {
    sheet.getRange(2, 1, existingRows, UNIFIED_HEADERS.length).clearContent();
  }

  if (!listings.length) {
    Logger.log('No listings to write.');
    return;
  }

  const rows = listings.map((listing) =>
    UNIFIED_HEADERS.map((key) => {
      if (key === 'amenities' || key === 'images') {
        return Array.isArray(listing[key]) ? listing[key].join('; ') : listing[key] || '';
      }
      if (key === 'parking') {
        return listing[key] ? 'TRUE' : 'FALSE';
      }
      return listing[key] ?? '';
    })
  );

  sheet.getRange(2, 1, rows.length, UNIFIED_HEADERS.length).setValues(rows);
}

function maybePingTelegram(listings, config) {
  if (!listings.length) return;
  if (!BOT_TOKEN || BOT_TOKEN.includes('PASTE_TELEGRAM_BOT_TOKEN')) return;
  if (!CHAT_ID || CHAT_ID.includes('PASTE_TELEGRAM_CHAT_ID')) return;

  const sorted = listings
    .slice()
    .filter((item) => typeof item.score === 'number')
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!sorted.length) return;

  const lines = sorted.map((item) => {
    const price = item.price ? `$${item.price}` : 'N/A';
    return `• ${item.title} (${price})\n  ${item.city || item.neighborhood || ''}\n  ${item.url}`;
  });

  const message = `🏙️ Condo Hunt\nTop picks right now:\n${lines.join('\n')}`;
  sendTelegramMessage(message);
}

function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: CHAT_ID,
    text: message,
    disable_web_page_preview: true
  };
  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (error) {
    Logger.log(`Telegram error: ${error.message}`);
  }
}

function testTelegram() {
  sendTelegramMessage('Condo Hunt test ping from Apps Script.');
}

function dedupeListings(listings) {
  const seen = {};
  const output = [];
  listings.forEach((listing) => {
    const key = listing.url || listing.title;
    if (!key || seen[key]) return;
    seen[key] = true;
    output.push(listing);
  });
  return output;
}

function scoreListing(listing, config) {
  let score = 0;
  const maxRent = Number(config.MAX_RENT || 1900);
  const exclude = splitConfigList(config.EXCLUDE_KEYWORDS, []);
  const mustHave = splitConfigList(config.MUST_HAVE_KEYWORDS, []);
  const preferred = splitConfigList(config.PREFERRED_AMENITIES, []);
  const minFloorRel = Number(config.MIN_FLOOR_REL || 0);

  if (listing.price && listing.price <= maxRent) {
    score += 20;
  } else if (listing.price) {
    score -= 15;
  }

  const haystack = `${listing.title || ''} ${listing.description || ''}`.toLowerCase();
  exclude.forEach((term) => {
    if (term && haystack.includes(term.toLowerCase())) {
      score -= 30;
    }
  });

  if (mustHave.length) {
    const allPresent = mustHave.every((term) => haystack.includes(term.toLowerCase()));
    score += allPresent ? 15 : -10;
  }

  if (Array.isArray(listing.amenities)) {
    listing.amenities.forEach((amenity) => {
      if (preferred.some((term) => amenity.toLowerCase().includes(term.toLowerCase()))) {
        score += 5;
      }
    });
  }

  if (listing.parking) {
    score += 5;
  }

  if (listing.floor && listing.total_floors) {
    const ratio = listing.total_floors ? listing.floor / listing.total_floors : 0;
    if (ratio >= minFloorRel) {
      score += 5;
    }
  }

  return score;
}

function splitConfigList(value, fallback) {
  if (!value) return fallback;
  return String(value)
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function safeFetchXml(url, label) {
  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'condo-hunt-apps-script'
      }
    });
    if (response.getResponseCode() !== 200) {
      Logger.log(`${label} fetch failed: ${response.getResponseCode()}`);
      return '';
    }
    return response.getContentText();
  } catch (error) {
    Logger.log(`${label} fetch error: ${error.message}`);
    return '';
  }
}

function parseRssItems(xml) {
  if (!xml) return [];
  const items = [];
  const matches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  matches.forEach((block) => {
    items.push({
      title: extractTag(block, 'title'),
      link: extractTag(block, 'link'),
      description: stripTags(extractTag(block, 'description')),
      pubDate: extractTag(block, 'pubDate'),
      enclosure: extractEnclosureUrl(block)
    });
  });
  return items;
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeHtml(match[1]) : '';
}

function extractEnclosureUrl(block) {
  const match = block.match(/<enclosure[^>]*url="([^"]+)"[^>]*>/i);
  if (match) return match[1];
  const media = block.match(/<media:content[^>]*url="([^"]+)"[^>]*>/i);
  return media ? media[1] : '';
}

function decodeHtml(value) {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return decodeHtml(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractNumeric(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/[, ]/g, '');
  const match = cleaned.match(/\$?(\d{3,5})/);
  return match ? Number(match[1]) : null;
}
