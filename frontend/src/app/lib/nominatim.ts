export interface ReverseGeocodeAddress {
  house_number?: string;
  road?: string;
  neighbourhood?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
  county?: string;
  state_district?: string;
  state?: string;
  region?: string;
  postcode?: string;
  country?: string;
}

export interface ReverseGeocodeResponse {
  display_name?: string;
  address?: ReverseGeocodeAddress;
}

interface SearchGeocodeResponseItem {
  place_id?: string | number;
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: ReverseGeocodeAddress;
}

export interface AddressSuggestion {
  id: string;
  fullName: string;
  address: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
}

export function normalizeLocationPart(value: string | undefined | null): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function dedupeLocationParts(parts: string[]): string[] {
  const seen = new Set<string>();

  return parts.filter((part) => {
    const normalizedPart = normalizeLocationPart(part);
    if (!normalizedPart) {
      return false;
    }

    const dedupeKey = normalizedPart.toLocaleLowerCase();
    if (seen.has(dedupeKey)) {
      return false;
    }

    seen.add(dedupeKey);
    return true;
  });
}

export function pickDetectedCity(address?: ReverseGeocodeAddress): string {
  return (
    address?.city?.trim() ||
    address?.town?.trim() ||
    address?.village?.trim() ||
    address?.municipality?.trim() ||
    address?.suburb?.trim() ||
    ""
  );
}

export function pickCoverageLabel(address?: ReverseGeocodeAddress): string {
  return (
    pickDetectedCity(address) ||
    address?.county?.trim() ||
    address?.state_district?.trim() ||
    address?.state?.trim() ||
    address?.country?.trim() ||
    ""
  );
}

export function pickDetectedRegion(address?: ReverseGeocodeAddress): string {
  return (
    address?.state_district?.trim() ||
    address?.state?.trim() ||
    address?.region?.trim() ||
    address?.county?.trim() ||
    ""
  );
}

export function buildEstimatedAddress(
  address?: ReverseGeocodeAddress,
  fallbackLabel?: string,
): string {
  const primaryLine = dedupeLocationParts([
    [normalizeLocationPart(address?.house_number), normalizeLocationPart(address?.road)]
      .filter(Boolean)
      .join(" "),
  ])[0];
  const addressParts = dedupeLocationParts([
    primaryLine,
    normalizeLocationPart(address?.neighbourhood),
    normalizeLocationPart(address?.suburb),
    pickDetectedCity(address),
    pickDetectedRegion(address),
    normalizeLocationPart(address?.postcode),
    normalizeLocationPart(address?.country),
  ]);

  if (addressParts.length > 0) {
    return addressParts.join(", ");
  }

  if (!fallbackLabel) {
    return "";
  }

  return dedupeLocationParts(
    fallbackLabel.split(",").map((part) => normalizeLocationPart(part)),
  ).join(", ");
}

export async function searchAddressSuggestions(
  query: string,
  signal?: AbortSignal,
): Promise<AddressSuggestion[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 3) {
    return [];
  }

  const params = new URLSearchParams({
    q: trimmedQuery,
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
    countrycodes: "ma",
    "accept-language": "fr",
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error("Impossible de proposer des suggestions d'adresse pour le moment.");
  }

  const payload = (await response.json()) as SearchGeocodeResponseItem[];

  return payload
    .map((item) => {
      const latitude = Number(item.lat);
      const longitude = Number(item.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      const address = buildEstimatedAddress(item.address, item.display_name);
      const fullName = normalizeLocationPart(item.display_name) || address;
      const city = pickDetectedCity(item.address);
      const region = pickDetectedRegion(item.address);
      const country = normalizeLocationPart(item.address?.country);

      return {
        id: String(item.place_id ?? `${latitude}-${longitude}`),
        fullName,
        address: address || fullName,
        city,
        region,
        postalCode: normalizeLocationPart(item.address?.postcode),
        country,
        latitude,
        longitude,
      } satisfies AddressSuggestion;
    })
    .filter((item): item is AddressSuggestion => item !== null);
}
