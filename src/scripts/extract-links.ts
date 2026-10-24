// extract-links.ts
// Simple script to read an Excel (or CSV) file and output all web URLs found.
// Usage (PowerShell):
//   node ./src/scripts/extract-links.js <path-to-file.xlsx>
// The script prints each URL on a new line to STDOUT or writes to links.txt.

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

// Helper to detect if a string looks like a web URL.
function isWebUrl(value: string): boolean {
  return /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(value.trim());
}

function extractFromExcel(filePath: string): string[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: '' });
  const urls: Set<string> = new Set();

  rows.forEach(row => {
    Object.values(row).forEach(cell => {
      if (typeof cell === 'string' && isWebUrl(cell)) {
        // Ensure the URL has a protocol.
        const url = cell.startsWith('http') ? cell.trim() : `https://${cell.trim()}`;
        urls.add(url);
      }
    });
  });
  return Array.from(urls);
}

function extractFromCsv(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const urls: Set<string> = new Set();
  lines.forEach(line => {
    line.split(/[,;\t]/).forEach(cell => {
      if (isWebUrl(cell)) {
        const url = cell.trim().startsWith('http') ? cell.trim() : `https://${cell.trim()}`;
        urls.add(url);
      }
    });
  });
  return Array.from(urls);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Please provide the path to an Excel (.xlsx) or CSV file.');
    process.exit(1);
  }
  const filePath = args[0];
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const ext = path.extname(filePath).toLowerCase();
  let urls: string[] = [];
  if (ext === '.xlsx' || ext === '.xls') {
    urls = extractFromExcel(filePath);
  } else if (ext === '.csv') {
    urls = extractFromCsv(filePath);
  } else {
    console.error('Unsupported file type. Use .xlsx, .xls, or .csv');
    process.exit(1);
  }

  // Output URLs – you can pipe this to a file or modify to write directly.
  urls.forEach(u => console.log(u));
}

main();
