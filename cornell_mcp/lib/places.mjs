// Campus places: buildings, parking lots and other points from Cornell's public campus map
// (www.cornell.edu/about/maps), the data its own map page loads.

import { InputError, cachedFetch, intArg, matchScore, normalize, truncate } from './util.mjs';

const URL_LOCATIONS = 'https://www.cornell.edu/about/maps/data.cfm?action=getLocations';
const MAP_PAGE = 'https://www.cornell.edu/about/maps/';
const TTL_MS = 24 * 60 * 60 * 1000;

function parseLocations(json) {
  return (json?.locations || [])
    .filter((l) => l?.Name)
    .map((l) => ({
      name: String(l.Name).trim(),
      aka: String(l.AKA || '').trim(),
      category: String(l.Folder || '').trim(),
      address: String(l.Address || '').trim(),
      notes: String(l.Notes || '').trim(),
      lat: l.LatLng?.lat ?? l.LatLngMap?.[0] ?? null,
      lng: l.LatLng?.lng ?? l.LatLngMap?.[1] ?? null,
    }));
}

function score(query, p) {
  const akas = p.aka.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const best = Math.max(matchScore(query, p.name), ...akas.map((a) => matchScore(query, a) - 1), 0);
  if (best) return best;
  return normalize(p.notes).includes(normalize(query)) ? 15 : 0;
}

export async function campusPlaceSearch(args = {}) {
  const query = String(args.query ?? '').trim();
  const category = String(args.category ?? '').trim();
  if (!query && !category) throw new InputError('Give a query (building or place name, e.g. "Gates Hall", "Duffield", "Barton") or a category (e.g. "Parking", "Athletics").');
  const { data, stale } = await cachedFetch(URL_LOCATIONS, { ttlMs: TTL_MS, edge: true });
  const all = parseLocations(data);
  if (!all.length) throw new Error('Unexpected campus map reply (no locations)');
  const categories = [...new Set(all.map((p) => p.category).filter(Boolean))].sort();
  let rows = all;
  if (category) {
    const c = categories.find((x) => normalize(x) === normalize(category)) || categories.find((x) => matchScore(category, x) >= 40);
    if (!c) throw new InputError(`No map category matches "${category}". Categories: ${categories.join(', ')}.`);
    rows = rows.filter((p) => p.category === c);
  }
  if (query) {
    const scored = rows
      .map((p) => ({ p, s: score(query, p) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.p.name.length - b.p.name.length);
    // Partial word matches ("hall") only count when nothing matches properly.
    const strong = scored.filter((x) => x.s >= 40);
    rows = (strong.length ? strong : scored).map((x) => x.p);
  } else {
    rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }
  const limit = intArg(args.limit, query ? 6 : 40, 1, 60);
  return {
    total: rows.length,
    places: rows.slice(0, limit).map((p) => ({
      name: p.name,
      ...(p.aka ? { also_known_as: p.aka } : {}),
      category: p.category || null,
      ...(p.address ? { address: p.address } : {}),
      ...(p.notes ? { notes: truncate(p.notes, 200) } : {}),
      ...(p.lat != null ? { lat: p.lat, lng: p.lng, directions: `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking` } : {}),
    })),
    ...(rows.length ? {} : { note: 'No place matches. Try a shorter name; the map lists buildings, parking lots and landmarks, not rooms or offices.', categories }),
    source: MAP_PAGE,
    ...(stale ? { warning: 'The campus map is unreachable; showing the last copy fetched.' } : {}),
  };
}

export const _internal = { parseLocations, score };
