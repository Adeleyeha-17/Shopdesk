// "Use my current location" at checkout: the phone's location, and the street it's on (from OpenStreetMap), so the
// customer doesn't have to type their address. Only asked for when the customer taps the button.

const SAY = {
  none: "This phone or browser can't share your location. Type your address instead.",
  blocked: 'Location is blocked for ShopDesk. Allow it in your browser settings, or type your address.',
  slow: 'Finding your location took too long. Try again, or type your address.',
  lost: "Couldn't find your location. Try again, or type your address.",
};

// A short address people recognise: "12 Allen Avenue, Ikeja, Lagos".
export function shortAddress(a) {
  if (!a) return '';
  const street = [a.house_number, a.road || a.pedestrian || a.footway || a.residential]
    .filter(Boolean)
    .join(' ');
  const area = a.neighbourhood || a.suburb || a.quarter || a.village || a.hamlet;
  const town = a.city || a.town || a.municipality || a.county;
  const parts = [street, area, town, a.state].filter(Boolean).map((x) => String(x).trim());
  return [...new Set(parts)].join(', ').slice(0, 150);
}

// The street at a spot, or '' if the lookup doesn't answer quickly (the map pin still goes with the order).
export async function addressAt(lat, lng) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`,
      { signal: ctl.signal },
    );
    if (!r.ok) return '';
    const j = await r.json();
    return shortAddress(j && j.address);
  } catch (e) {
    return '';
  } finally {
    clearTimeout(t);
  }
}

// Where the customer is now: { lat, lng, acc (metres), address ('' if unknown) }. Errors are sentences to show.
export function currentPlace() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error(SAY.none));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = +pos.coords.latitude.toFixed(6),
          lng = +pos.coords.longitude.toFixed(6);
        resolve({ lat, lng, acc: Math.round(pos.coords.accuracy || 0), address: await addressAt(lat, lng) });
      },
      (e) => reject(new Error(e.code === 1 ? SAY.blocked : e.code === 3 ? SAY.slow : SAY.lost)),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    );
  });
}
