import { mkdir, open, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from 'node:process';

import algoliasearch from 'algoliasearch';

import { readDirPages } from './listPages.mjs';
import { getRecords } from './listRecords.mjs';

const ROOT_DIR = resolve('..', '..');
const DIST_DIR = join(ROOT_DIR, 'dist/');
const DATA_DIR = join(ROOT_DIR, 'data/');

/** @returns {Promise<Object.<string, number>>} */
async function readStats() {
    return JSON.parse(await readFile(DATA_DIR + 'page_views_map.json', { encoding: 'utf8' }));
}

/** @type {Object.<string, number>} */
const pageTypesReport = {};

const [searchIndex, reportUnknown, reportRedirects, reportTypes, reportSlash] = await Promise.all([
    open(ROOT_DIR + '/index-new.json', 'w'),
    open(ROOT_DIR + '/report.unknown_files.txt', 'w'),
    open(ROOT_DIR + '/report.redirects.txt', 'w'),
    open(ROOT_DIR + '/report.types.txt', 'w')
]);

/**
 * @param {string} type
 * @param {string} url
 * @returns {Promise<void>}
 */
async function addFileReports({ type, url }) {
    await Promise.all([
        type === 'Unknown' && reportUnknown.appendFile(url + '\n', { encoding: 'utf8' }),
        type === 'Redirect' && reportRedirects.appendFile(url + '\n', { encoding: 'utf8' })
    ]);

    if (!pageTypesReport[type]) pageTypesReport[type] = 0;
    pageTypesReport[type]++;
}

const [stats, pages] = await Promise.all([
    readStats(),
    readDirPages(DIST_DIR, addFileReports)
]);

/**
 * @param {Object.<string, number>} types
 * @returns {Promise<string>}
 */
async function getReportTypes(types) {
    return Object.keys(types)
        .sort((a, b) => pageTypesReport[b] - pageTypesReport[a])
        .map(key => `${key}: ${pageTypesReport[key]}`)
        .join('\n');
}

async function writeRecords(pages, stats) {
    const records = await getRecords(pages, stats);

    await Promise.all([
        searchIndex.writeFile(JSON.stringify(records.sort((a1, b1) => {
            const a = JSON.stringify(a1).length;
            const b = JSON.stringify(b1).length;
            return a > b ? 1 : a < b ? -1 : 0;
        }), null, 2), { encoding: 'utf8' })
            .then(() => searchIndex.close()),

        algoliasearch(env['WH_SEARCH_USER'], env['WH_SEARCH_WRITE_KEY'])
            .initIndex(env['WH_INDEX_NAME'])
            .replaceAllObjects(records).wait()
    ]);
}

await Promise.all([
    reportUnknown.close(),
    reportRedirects.close(),
    reportTypes.writeFile(await getReportTypes(pageTypesReport), { encoding: 'utf8' })
        .then(() => reportTypes.close()),
    writeRecords(pages, stats)
]);
