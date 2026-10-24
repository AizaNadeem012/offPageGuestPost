// run-campaign.ts
// Orchestrates the full backlink‑building pipeline:
//   1. Extract URLs from an Excel/CSV file (using the extract‑links utility).
//   2. For each URL, perform a lightweight accessibility check and look for guest‑post cues.
//   3. Write a CSV report summarising the eligibility of each site.
//
// Usage (PowerShell):
//   npx ts-node src/scripts/run-campaign.ts <path-to-spreadsheet.xlsx>
//   # or after building:
//   node ./dist/scripts/run-campaign.js <path-to-spreadsheet.xlsx>

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as https from 'https';
import * as http from 'http';

// ---------- Helper: run the extract‑links script and capture its output ----------
function getUrlsFromFile(spreadsheetPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    try {
      const cmd = `npx ts-node src/scripts/extract-links.ts "${spreadsheetPath}"`;
      const output = execSync(cmd, { encoding: 'utf8' });
      const urls = output
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0);
      resolve(urls);
    } catch (e) {
      reject(e);
    }
  });
}

// ---------- Helper: simple fetch with timeout ----------
function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<{ ok: boolean; status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ ok: res.statusCode === 200, status: res.statusCode || 0, text: body });
      });
    });
    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

// ---------- Helper: check for guest‑post cues ----------
function containsGuestPostCues(html: string): boolean {
  const cues = [
    /guest\s?post/i,
    /write\s?for\s?us/i,
    /contribute/i,
    /submit\s?article/i,
    /become\s?a\s?author/i,
    /submit\s?guest\s?post/i,
    /become\s?contributor/i,
  ];
  return cues.some(re => re.test(html));
}

// ---------- Main orchestration ----------
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Please provide the path to the spreadsheet (xlsx or csv).');
    process.exit(1);
  }
  const spreadsheetPath = args[0];
  if (!fs.existsSync(spreadsheetPath)) {
    console.error(`File not found: ${spreadsheetPath}`);
    process.exit(1);
  }

  console.log('🔎 Extracting URLs from spreadsheet...');
  const urls = await getUrlsFromFile(spreadsheetPath);
  console.log(`✅ Extracted ${urls.length} URLs.`);

  const results: Array<{ url: string; status: string; notes: string }> = [];

  console.log('📡 Assessing each site (this may take a minute per site)...');
  for (const rawUrl of urls) {
    let url = rawUrl;
    if (!url.startsWith('http')) {
      url = `https://${url}`;
    }
    try {
      const response = await fetchWithTimeout(url, 10000);
      if (!response.ok) {
        results.push({ url, status: 'unreachable', notes: `HTTP ${response.status}` });
        continue;
      }
      const hasGuestCues = containsGuestPostCues(response.text);
      if (hasGuestCues) {
        results.push({ url, status: 'eligible', notes: 'Guest‑post cues detected' });
      } else {
        results.push({ url, status: 'not eligible', notes: 'No guest‑post cues' });
      }
    } catch (err: any) {
      results.push({ url, status: 'error', notes: err.message ?? 'unknown error' });
    }
  }

  // Write CSV report
  const reportPath = path.resolve('campaign-report.csv');
  const header = 'url,status,notes\n';
  const rows = results.map(r => `${r.url},${r.status},"${r.notes.replace(/"/g, '""')}"`).join('\n');
  fs.writeFileSync(reportPath, header + rows, 'utf8');
  console.log(`📄 Report written to ${reportPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
