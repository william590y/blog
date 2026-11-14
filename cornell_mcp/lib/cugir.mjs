// CUGIR, the Cornell University Geospatial Information Repository (cugir.library.cornell.edu):
// New York State geospatial datasets. It is a GeoBlacklight site; search uses its JSON view and
// a dataset's detail comes from the record's raw (Aardvark) metadata.

import { HttpError, InputError, cachedFetch, htmlToText, intArg, truncate } from './util.mjs';

const BASE = 'https://cugir.library.cornell.edu';
const TTL_MS = 60 * 60 * 1000;

const value = (attr) => {
  const v = attr?.attributes?.value ?? attr;
  if (v == null || typeof v === 'object') return null;
  return htmlToText(String(v));
};
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

function searchRow(doc) {
  const a = doc.attributes || {};
  return {
    id: doc.id,
    title: a.title || value(a.dct_title_s) || doc.id,
    ...(value(a.dct_creator_sm) ? { creator: truncate(value(a.dct_creator_sm), 120) } : {}),
    ...(value(a.gbl_indexYear_im) ? { year: value(a.gbl_indexYear_im) } : {}),
    ...(value(a.dct_description_sm) ? { description: truncate(value(a.dct_description_sm), 220) } : {}),
    url: `${BASE}/catalog/${doc.id}`,
  };
}

/** "ENVELOPE(west, east, north, south)" -> {west, east, north, south}. */
function parseEnvelope(s) {
  const m = /ENVELOPE\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(s || '');
  return m ? { west: +m[1], east: +m[2], north: +m[3], south: +m[4] } : null;
}

function references(raw) {
  let refs;
  try {
    refs = JSON.parse(raw.dct_references_s || '{}');
  } catch {
    refs = {};
  }
  const downloads = arr(refs['http://schema.org/downloadUrl'])
    .map((d) => (typeof d === 'string' ? { url: d } : { format: d.label, url: d.url }))
    .filter((d) => d.url);
  const out = {};
  if (downloads.length) out.downloads = downloads.slice(0, 8);
  const meta = refs['http://www.w3.org/1999/xhtml'] || refs['http://www.opengis.net/cat/csw/csdgm'] || refs['http://www.isotc211.org/schemas/2005/gmd/'];
  if (meta) out.metadata = meta;
  const services = {};
  if (refs['http://www.opengis.net/def/serviceType/ogc/wms']) services.wms = refs['http://www.opengis.net/def/serviceType/ogc/wms'];
  if (refs['http://www.opengis.net/def/serviceType/ogc/wfs']) services.wfs = refs['http://www.opengis.net/def/serviceType/ogc/wfs'];
  if (refs['urn:x-esri:serviceType:ArcGIS#FeatureLayer']) services.arcgis_feature_layer = refs['urn:x-esri:serviceType:ArcGIS#FeatureLayer'];
  if (Object.keys(services).length) {
    out.web_services = { ...services, ...(raw.gbl_wxsIdentifier_s ? { layer: raw.gbl_wxsIdentifier_s } : {}) };
  }
  return out;
}

function datasetDetail(raw) {
  const bbox = parseEnvelope(raw.dcat_bbox || raw.locn_geometry);
  const put = (label, v, max = 10) => (arr(v).length ? { [label]: arr(v).slice(0, max) } : {});
  return {
    id: raw.id,
    title: raw.dct_title_s,
    ...(arr(raw.dct_description_sm).length ? { description: truncate(arr(raw.dct_description_sm).join(' '), 1500) } : {}),
    ...put('creators', raw.dct_creator_sm),
    ...put('publishers', raw.dct_publisher_sm, 4),
    ...(raw.dct_issued_s ? { issued: raw.dct_issued_s } : {}),
    ...put('time_period', raw.dct_temporal_sm, 4),
    ...put('places', raw.dct_spatial_sm),
    ...put('themes', raw.dcat_theme_sm),
    ...put('subjects', raw.dct_subject_sm, 15),
    ...put('resource_class', raw.gbl_resourceClass_sm, 3),
    ...put('resource_type', raw.gbl_resourceType_sm, 3),
    ...(raw.dct_format_s ? { format: raw.dct_format_s } : {}),
    ...(raw.gbl_fileSize_s ? { file_size: raw.gbl_fileSize_s } : {}),
    ...(raw.dct_accessRights_s ? { access: raw.dct_accessRights_s } : {}),
    ...put('rights', raw.dct_rights_sm, 2),
    ...put('license', raw.dct_license_sm, 2),
    ...(bbox ? { bounding_box: bbox } : {}),
    ...references(raw),
    ...(raw.gbl_mdModified_dt ? { metadata_modified: String(raw.gbl_mdModified_dt).slice(0, 10) } : {}),
    url: `${BASE}/catalog/${raw.id}`,
  };
}

export async function cugirSearch(args = {}) {
  const query = String(args.query ?? '').trim();
  const limit = intArg(args.limit, 10, 1, 30);
  const page = intArg(args.page, 1, 1, 500);
  const params = new URLSearchParams({ q: query, per_page: String(limit), page: String(page) });
  const { data } = await cachedFetch(`${BASE}/catalog.json?${params}`, { ttlMs: TTL_MS, edge: true });
  if (!Array.isArray(data?.data)) throw new Error('Unexpected CUGIR reply (no data list).');
  const pages = data.meta?.pages || {};
  return {
    query: query || '(everything)',
    total: pages.total_count ?? data.data.length,
    page: pages.current_page ?? page,
    pages: pages.total_pages ?? 1,
    datasets: data.data.map(searchRow),
    ...(data.data.length ? {} : { note: 'No datasets match. CUGIR holds New York State GIS data: try a place (county, town) or a theme such as roads, parcels, hydrography, elevation, soils.' }),
    source: BASE,
  };
}

export async function cugirDataset(args = {}) {
  const text = String(args.id ?? '').trim();
  const m = /(cugir-[a-z0-9-]+)/i.exec(text) || /^(\d{1,6})$/.exec(text);
  if (!m) throw new InputError('id must be a CUGIR dataset id such as "cugir-007879" (from cugir_search).');
  const id = /^\d+$/.test(m[1]) ? `cugir-${m[1].padStart(6, '0')}` : m[1].toLowerCase();
  let raw;
  try {
    ({ data: raw } = await cachedFetch(`${BASE}/catalog/${id}/raw`, { ttlMs: TTL_MS, edge: true }));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) throw new InputError(`No CUGIR dataset ${id}. Use cugir_search to find the id.`);
    throw err;
  }
  if (!raw?.id) throw new Error('Unexpected CUGIR reply (no record).');
  return datasetDetail(raw);
}

export const _internal = { searchRow, datasetDetail, parseEnvelope };
