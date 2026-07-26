const PAGE_SEARCH_QUERY_PARAM = "q";
const HEADER_SEARCHABLE_PATHS = new Set(["/dashboard", "/lignes", "/forfaits/attributions"]);

export function canUseHeaderSearch(pathname: string): boolean {
  return HEADER_SEARCHABLE_PATHS.has(pathname);
}

export function getPageSearchQuery(search: string): string {
  return new URLSearchParams(search).get(PAGE_SEARCH_QUERY_PARAM) ?? "";
}

export function buildSearchUrl(
  pathname: string,
  currentSearch: string,
  nextQuery: string,
): string {
  const params = new URLSearchParams(currentSearch);

  if (nextQuery.trim() === "") {
    params.delete(PAGE_SEARCH_QUERY_PARAM);
  } else {
    params.set(PAGE_SEARCH_QUERY_PARAM, nextQuery);
  }

  const nextSearch = params.toString();
  return nextSearch === "" ? pathname : `${pathname}?${nextSearch}`;
}
