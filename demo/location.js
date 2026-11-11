// "Use my current location" in the demo: the browser isn't asked (the demo page may not be allowed to); a sample spot
// in Victoria Island is used, as if the phone had found it.
export const shortAddress = () => '';
export const addressAt = async () => '12 Adeola Odeku Street, Victoria Island, Lagos';
export async function currentPlace() {
  await new Promise((r) => setTimeout(r, 700));
  return { lat: 6.430962, lng: 3.420416, acc: 18, address: '12 Adeola Odeku Street, Victoria Island, Lagos' };
}
