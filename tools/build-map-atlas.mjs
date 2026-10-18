import { pilotStudies } from './build-map-pilot.mjs';

export function atlasStudies() {
  const biomes = [
    ['forest', 'forest', 'field', 'field2', 'river', 'water', 'beach', 'desert', 'desert', 'mountain', 'mountain', 'rocks'],
    ['forest', 'jungle', 'field3', 'field4', 'river', 'waterswim', 'shore', 'desert', 'quicksand', 'hills', 'mountain', 'plain'],
    ['jungle', 'forest', 'flowers1', 'flowers2', 'river', 'waternoswim', 'shore', 'beach', 'desert', 'hills', 'rocks', 'plain'],
    ['swamp', 'swamp', 'field', 'field', 'river', 'underwater', 'ocean', 'ocean2', 'ocean3', 'ocean4', 'chaos_sea', 'ship'],
    ['dead_forest', 'dead_jungle', 'dead_field', 'ashen_field', 'ice', 'snow', 'icehills', 'icemount', 'mountain_cyan', 'ice', 'snow', 'ice'],
    ['dead_forest', 'dead_field', 'smallroad', 'plain', 'ice', 'snow', 'icehills', 'icemount', 'mountain_cyan', 'ice', 'insideice', 'ice'],
    ['plain', 'smallroad_ew', 'smallroad_ew', 'trail_ew', 'trail_ew', 'plain', 'plain', 'plain', 'plain', 'rocks', 'rocks', 'rocks'],
  ];
  const interiors = [
    ['city', 'castle', 'shop', 'well', 'temple', 'palace_room', 'inside', 'office', 'archive', 'bookshelves', 'bookshelves_ns', 'hallway'],
    ['city', 'castle', 'shop', 'fountain', 'aylorcity', 'palace_room', 'hut', 'cabin', 'inside', 'bookshelves', 'bookshelves_ns', 'hallway'],
    ['alley', 'city_underground', 'stairs', 'pillar', 'mudschool', 'lottery', 'dungeon', 'crypt', 'ruins', 'cave', 'graveyard', 'dark'],
    ['bridge', 'city', 'clanexit', 'areaexit', 'chesswhite', 'chessblack', 'underground', 'crypt', 'ruins', 'cave', 'bloodyhall', 'bloodyroom'],
    ['hellinside', 'hellhall', 'hell1', 'hell2', 'hell3', 'hell4', 'volcano', 'hellfountain', 'city', 'shop', 'afountain', 'redcarpet'],
    ['hellinside', 'hellhall', 'hell1', 'hell2', 'hell3', 'hell4', 'volcano', 'hellfountain', 'city', 'shop', 'fountain', 'redcarpet'],
  ];
  const skies = [
    ['air', 'cloud1', 'cloud2', 'cloud3', 'mist', 'rain', 'sun', 'electric', 'lightning', 'wind1', 'wind2', 'tornado'],
    ['air', 'cloud1', 'cloud2', 'cloud3', 'mist', 'rain', 'sun', 'electric', 'lightning', 'wind1', 'wind2', 'dustdevil'],
    ['space1', 'space1', 'space2', 'space2', 'space3', 'space3', 'space4', 'space4', 'moon', 'moon', 'rainbow', 'rainbow'],
    ['space1', 'space1', 'space2', 'space2', 'space3', 'space3', 'space4', 'space4', 'moon', 'moon', 'default', 'unused'],
  ];
  return [...pilotStudies(),
    { id: 'wilderness', title: 'Wilderness and water', note: 'Repeated and mixed natural surfaces, fine ground and smaller overhead scenery. Boundaries between different material families remain visible.', rows: biomes, overlays: [{ kind: 'player', x: 2, y: 2 }, { kind: 'arrow', x: 4, y: 3 }] },
    { id: 'interiors', title: 'Interiors and the underworld', note: 'Shared slate and timber, compact furnishings, overhead stairs, quieter infernal ground and localized blood stains.', rows: interiors, overlays: [{ kind: 'player', x: 1, y: 2 }, { kind: 'flag', x: 5, y: 3 }] },
    { id: 'planes', title: 'Weather, moons and planes', note: 'Distinct cloud silhouettes, wind forms and astral patterns. White, grey and black moons remain neutral; accents do not indicate live game conditions.', rows: skies, overlays: [] },
  ];
}

export function atlasStudyHtml(studies) {
  // All text is defined above; images are renderer-produced PNG bytes.
  return `<section aria-label="Atlas layout studies"><h2>Whole environments at map scale</h2><p>Illustrative layouts with simulated walls, arrows, flags and player markers. No room records were read or changed. Each pair shows the same render at 32 px and 60 px per room.</p>${studies.map(study => `<section><h2>${study.title}</h2><p>${study.note}</p>${[32, 60].map(size => `<figure class="map-study" style="overflow:auto;max-width:100%"><img style="width:${study.rows[0].length * size}px;max-width:none;border-radius:0" src="data:image/png;base64,${study.png.toString('base64')}" width="${study.rows[0].length * 60}" height="${study.rows.length * 60}" alt="${study.title}, ${size} px rooms"><figcaption>${size} px rooms · ${study.title}</figcaption></figure>`).join('')}</section>`).join('')}</section>`;
}
