import { apiFetch, ApiError } from "./client";

export type MediaType = "movie" | "tv" | "mix";

export interface Movie {
  id: number;
  title: string;
  poster_path?: string;
  poster_url?: string;
  release_date?: string;
  overview?: string;
  imdb_id?: string;
  media_type?: "movie" | "tv";
  popularity?: number;
  vote_average?: number;
  number_of_seasons?: number;
  number_of_episodes?: number;
  credits?: {
    cast: Person[];
    crew: CrewMember[];
  };
}

export interface Person {
  id: number;
  name: string;
  profile_path?: string;
  character?: string;
}

export interface CrewMember {
  id: number;
  name: string;
  profile_path?: string;
  job: string;
}

export interface PersonSummary {
  id: number;
  name: string;
  profile_path?: string;
  known_for_department?: string;
}

export interface PersonWork {
  id: number;
  title: string;
  poster_path?: string;
  release_date?: string;
  media_type: "movie" | "tv";
  popularity?: number;
  vote_average?: number;
  role_summary?: string;
  role_categories?: string[];
}

export interface PersonWorksResponse {
  person: PersonSummary;
  works: PersonWork[];
}

export interface HomeSection {
  id: string;
  title: string;
  results: Movie[];
  next_cursor?: string;
  next_page?: number;
  total_pages?: number;
}

export interface HomeResponse {
  sections: HomeSection[];
  has_more: boolean;
  next_page?: number;
  message?: string;
}

export interface ProviderInfo {
  provider_id: number;
  provider_name: string;
  logo_path?: string;
}

export interface CountryProviders {
  link?: string;
  flatrate?: ProviderInfo[];
  free?: ProviderInfo[];
  ads?: ProviderInfo[];
  rent?: ProviderInfo[];
  buy?: ProviderInfo[];
}

export interface StreamingLink {
  service_name: string;
  type: string;
  link?: string;
  quality?: string;
  price?: string;
  audios?: string[];
  subtitles?: string[];
  expires_on?: number;
}

export interface Region {
  iso_3166_1: string;
  english_name: string;
}

export interface GenreOption {
  id: number;
  name: string;
}

export interface PersonOption {
  id: number;
  name: string;
  known_for_department?: string;
  profile_path?: string;
}

export type ContentMode = "all" | "available" | "streamable";

export interface AdvancedSearchParams {
  page?: number;
  limit?: number;
  mediaType?: MediaType;
  query?: string;
  country?: string;
  language?: string;
  yearFrom?: number;
  yearTo?: number;
  genreIds?: number[];
  excludeGenreIds?: number[];
  actorIds?: number[];
  directorIds?: number[];
  minRating?: number;
  minVotes?: number;
  runtimeMin?: number;
  runtimeMax?: number;
  sortBy?: "popularity.desc" | "popularity.asc" | "release.desc" | "release.asc" | "rating.desc" | "rating.asc" | "votes.desc" | "votes.asc";
  contentMode?: ContentMode;
  providerIds?: number[];
  countries?: string[];
  vpn?: boolean;
  includePaid?: boolean;
}

export interface AdvancedSearchResponse {
  results: Movie[];
  page: number;
  next_page?: number;
  total_pages?: number;
  has_more?: boolean;
}

export async function searchMovies(
  q: string,
  mediaType: MediaType = "movie",
  limit = 20
): Promise<{ results: Movie[] }> {
  return apiFetch(`/api/search?q=${encodeURIComponent(q)}&media_type=${mediaType}&limit=${limit}`);
}

export async function searchPage(
  q: string,
  page: number,
  mediaType: MediaType = "movie",
  limit = 20
): Promise<{ results: Movie[]; page?: number; total_pages?: number }> {
  try {
    return await apiFetch(
      `/api/search_page?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}&media_type=${mediaType}`
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return await apiFetch(
        `/api/search?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}&media_type=${mediaType}`
      );
    }
    throw err;
  }
}

export async function searchFilteredPage(
  q: string,
  page: number,
  providerIds: number[],
  mediaType: MediaType = "movie",
  limit = 20,
  countries?: string[],
  vpn = false,
  includePaid = false
): Promise<{ results: Movie[]; page?: number; total_pages?: number }> {
  const ids = providerIds.join(",");
  const countriesParam = countries && countries.length ? `&countries=${encodeURIComponent(countries.join(","))}` : "";
  const vpnParam = vpn ? "&vpn=1" : "";
  const paidParam = includePaid ? "&include_paid=1" : "";
  try {
    return await apiFetch(
      `/api/search_filtered_page?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}${ids ? `&provider_ids=${ids}` : ""}&media_type=${mediaType}${countriesParam}${vpnParam}${paidParam}`
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return await apiFetch(
        `/api/search_filtered?q=${encodeURIComponent(q)}&page=${page}&paged=1&limit=${limit}${ids ? `&provider_ids=${ids}` : ""}&media_type=${mediaType}${countriesParam}${vpnParam}${paidParam}`
      );
    }
    throw err;
  }
}

export async function searchFiltered(
  q: string,
  providerIds: number[],
  mediaType: MediaType = "movie",
  options?: { limit?: number; countries?: string[]; vpn?: boolean; includePaid?: boolean }
): Promise<{ results: Movie[] }> {
  const ids = providerIds.join(",");
  const limitParam = options?.limit ? `&limit=${options.limit}` : "";
  const countriesParam = options?.countries && options.countries.length
    ? `&countries=${encodeURIComponent(options.countries.join(","))}`
    : "";
  const vpnParam = options?.vpn ? "&vpn=1" : "";
  const paidParam = options?.includePaid ? "&include_paid=1" : "";
  return apiFetch(
    `/api/search_filtered?q=${encodeURIComponent(q)}${ids ? `&provider_ids=${ids}` : ""}&media_type=${mediaType}${limitParam}${countriesParam}${vpnParam}${paidParam}`
  );
}

export async function getHome(
  page: number,
  pageSize: number,
  providerIds: number[],
  mediaType: MediaType = "mix",
  country?: string,
  unfiltered = false,
  vpn = false,
  includePaid = false,
  countries?: string[]
): Promise<HomeResponse> {
  const ids = providerIds.join(",");
  const providerParam = ids ? `&provider_ids=${ids}` : (unfiltered ? "&provider_ids=," : "");
  const countryParam = country ? `&country=${encodeURIComponent(country)}` : "";
  const unfilteredParam = unfiltered ? "&unfiltered=1" : "";
  const vpnParam = vpn ? "&vpn=1" : "";
  const includePaidParam = includePaid ? "&include_paid=1" : "";
  const countriesParam = countries && countries.length ? `&countries=${encodeURIComponent(countries.join(","))}` : "";
  return apiFetch(
    `/api/home?page=${page}&page_size=${pageSize}${providerParam}${countryParam}${countriesParam}${unfilteredParam}${vpnParam}${includePaidParam}&media_type=${mediaType}`
  );
}

export async function getSection(
  sectionId: string,
  page: number,
  pages: number,
  providerIds: number[],
  cursor?: string,
  mediaType: MediaType = "mix",
  country?: string,
  unfiltered = false,
  vpn = false,
  includePaid = false,
  countries?: string[]
): Promise<HomeSection & { next_cursor?: string }> {
  const ids = providerIds.join(",");
  const providerParam = ids ? `&provider_ids=${ids}` : (unfiltered ? "&provider_ids=," : "");
  const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
  const countryParam = country ? `&country=${encodeURIComponent(country)}` : "";
  const countriesParam = countries && countries.length ? `&countries=${encodeURIComponent(countries.join(","))}` : "";
  const unfilteredParam = unfiltered ? "&unfiltered=1" : "";
  const vpnParam = vpn ? "&vpn=1" : "";
  const includePaidParam = includePaid ? "&include_paid=1" : "";
  return apiFetch(
    `/api/section?section_id=${encodeURIComponent(sectionId)}&page=${page}&pages=${pages}${providerParam}${cursorParam}${countryParam}${countriesParam}${unfilteredParam}${vpnParam}${includePaidParam}&media_type=${mediaType}`
  );
}

export async function getMovieProviders(
  movieId: number
): Promise<{ movie: Movie; providers: Record<string, CountryProviders> }> {
  return apiFetch(`/api/movie/${movieId}/providers`);
}

export async function getMovieLinks(
  movieId: number
): Promise<{ streaming?: Record<string, StreamingLink[]>; movie_info?: { poster?: string; backdrop?: string } }> {
  return apiFetch(`/api/movie/${movieId}/links`);
}

export async function getTvProviders(
  tvId: number
): Promise<{ movie: Movie; providers: Record<string, CountryProviders> }> {
  return apiFetch(`/api/tv/${tvId}/providers`);
}

export async function getTvLinks(
  tvId: number
): Promise<{ streaming?: Record<string, StreamingLink[]>; movie_info?: { poster?: string; backdrop?: string } }> {
  return apiFetch(`/api/tv/${tvId}/links`);
}

export async function getPersonWorks(personId: number): Promise<PersonWorksResponse> {
  return apiFetch(`/api/person/${personId}/works`);
}

export async function getProviders(
  country?: string
): Promise<ProviderInfo[]> {
  const url = country ? `/api/providers?country=${encodeURIComponent(country)}` : "/api/providers";
  return apiFetch(url);
}

export async function getRegions(): Promise<Region[]> {
  return apiFetch("/api/regions");
}

export async function getGeoCountry(): Promise<string> {
  try {
    const data = await apiFetch<{ country: string }>("/api/geo");
    return data.country || "US";
  } catch {
    return "US";
  }
}

export async function getGenres(mediaType: MediaType = "mix"): Promise<GenreOption[]> {
  const data = await apiFetch<{ results?: GenreOption[] }>(`/api/genres?media_type=${mediaType}`);
  return data.results || [];
}

export async function searchPeople(q: string, limit = 8): Promise<PersonOption[]> {
  const data = await apiFetch<{ results?: PersonOption[] }>(
    `/api/search_people?q=${encodeURIComponent(q)}&limit=${Math.max(1, Math.min(20, limit))}`
  );
  return data.results || [];
}

export async function searchAdvanced(params: AdvancedSearchParams): Promise<AdvancedSearchResponse> {
  const query = new URLSearchParams();
  query.set("page", String(Math.max(1, params.page || 1)));
  query.set("limit", String(Math.max(1, Math.min(40, params.limit || 24))));
  query.set("media_type", params.mediaType || "movie");
  query.set("content_mode", params.contentMode || "all");

  if (params.query && params.query.trim()) query.set("q", params.query.trim());
  if (params.country) query.set("country", params.country);
  if (params.language) query.set("language", params.language);
  if (typeof params.yearFrom === "number") query.set("year_from", String(params.yearFrom));
  if (typeof params.yearTo === "number") query.set("year_to", String(params.yearTo));
  if (params.genreIds?.length) query.set("genre_ids", params.genreIds.join(","));
  if (params.excludeGenreIds?.length) query.set("exclude_genre_ids", params.excludeGenreIds.join(","));
  if (params.actorIds?.length) query.set("actor_ids", params.actorIds.join(","));
  if (params.directorIds?.length) query.set("director_ids", params.directorIds.join(","));
  if (typeof params.minRating === "number") query.set("min_rating", String(params.minRating));
  if (typeof params.minVotes === "number") query.set("min_votes", String(params.minVotes));
  if (typeof params.runtimeMin === "number") query.set("runtime_min", String(params.runtimeMin));
  if (typeof params.runtimeMax === "number") query.set("runtime_max", String(params.runtimeMax));
  if (params.sortBy) query.set("sort_by", params.sortBy);
  if (params.providerIds?.length) query.set("provider_ids", params.providerIds.join(","));
  if (params.countries?.length) query.set("countries", params.countries.join(","));
  if (params.vpn) query.set("vpn", "1");
  if (params.includePaid) query.set("include_paid", "1");

  return apiFetch<AdvancedSearchResponse>(`/api/search_advanced?${query.toString()}`);
}
