// The areas a customer picks from at checkout, so shops can see where their deliveries go.
// Lagos first (most shops are there), then other cities. "Somewhere else" lets them type their own.
// prettier-ignore
export const LAGOS = [
  'Abule Egba', 'Agege', 'Ajah', 'Alaba', 'Alimosho', 'Amuwo Odofin', 'Anthony', 'Apapa', 'Badagry', 'Banana Island',
  'Berger', 'Dolphin Estate', 'Ebute Metta', 'Egbeda', 'Ejigbo', 'Epe', 'Festac', 'Gbagada', 'Ibeju-Lekki', 'Idimu',
  'Ifako', 'Igando', 'Ijaiye', 'Ijora', 'Ikeja', 'Ikeja GRA', 'Ikorodu', 'Ikota', 'Ikotun', 'Ikoyi', 'Ilupeju',
  'Ipaja', 'Isolo', 'Jakande', 'Ketu', 'Lagos Island', 'Lekki Phase 1', 'Lekki (Chevron, Osapa, Agungi)', 'Magodo',
  'Maryland', 'Mile 2', 'Mushin', 'Obalende', 'Ogba', 'Ogudu', 'Ojo', 'Ojodu', 'Ojota', 'Okota', 'Omole', 'Oniru',
  'Opebi', 'Oregun', 'Oshodi', 'Palmgrove', 'Sangotedo', 'Satellite Town', 'Shomolu', 'Surulere', 'Victoria Island',
  'Yaba',
];
// prettier-ignore
export const CITIES = [
  'Abeokuta', 'Abuja', 'Akure', 'Asaba', 'Awka', 'Benin City', 'Calabar', 'Enugu', 'Ibadan', 'Ijebu Ode', 'Ilorin',
  'Jos', 'Kaduna', 'Kano', 'Lokoja', 'Mowe / Ibafo', 'Ogbomosho', 'Onitsha', 'Osogbo', 'Ota / Sango', 'Owerri',
  'Port Harcourt', 'Uyo', 'Warri',
];

// Other ways people write an area in an address
const ALIASES = {
  'Victoria Island': ['vi', 'v.i', 'v/i'],
  'Ikeja GRA': ['gra ikeja'],
  'Lekki Phase 1': ['lekki', 'lekki phase one', 'lekki ph 1', 'admiralty'],
  'Lekki (Chevron, Osapa, Agungi)': ['chevron', 'osapa', 'agungi', 'ologolo', 'idado', 'orchid'],
  'Ibeju-Lekki': ['ibeju lekki', 'ibeju'],
  'Ebute Metta': ['ebute-metta', 'ebute meta', 'ebutte metta'],
  Festac: ['festac town'],
  Berger: ['ojodu berger'],
  'Ota / Sango': ['ota', 'sango', 'sango ota', 'sango-ota'],
  'Mowe / Ibafo': ['mowe', 'ibafo'],
  'Benin City': ['benin'],
  'Port Harcourt': ['portharcourt', 'port-harcourt'],
  Abuja: ['fct', 'wuse', 'maitama', 'garki', 'asokoro', 'gwarinpa', 'jabi', 'kubwa', 'lugbe'],
  Shomolu: ['somolu', 'bariga'],
  'Lagos Island': ['idumota', 'marina', 'broad street'],
  'Satellite Town': ['satellite'],
  'Amuwo Odofin': ['amuwo', 'festac 2nd gate'],
};
const NAMES = [...LAGOS, ...CITIES].flatMap((a) => [
  [a.toLowerCase(), a],
  ...(ALIASES[a] || []).map((x) => [x, a]),
]);
const clean = (s) =>
  ' ' +
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9./ -]+/g, ' ')
    .replace(/\s+/g, ' ') +
  ' ';

// The area named in an address ("4 Admiralty Way, Lekki Phase 1" -> "Lekki Phase 1"), or '' when there isn't one.
// The longest name wins, so "Ikeja GRA" beats "Ikeja" and "Ibeju-Lekki" beats "Lekki".
export function areaIn(address) {
  const text = clean(address);
  let best = null;
  for (const [name, area] of NAMES) {
    const at = text.indexOf(' ' + name);
    if (at < 0) continue;
    const after = text[at + name.length + 1];
    if (after && /[a-z0-9]/.test(after)) continue; // part of a longer word
    if (!best || name.length > best.len) best = { len: name.length, area };
  }
  return best ? best.area : '';
}
