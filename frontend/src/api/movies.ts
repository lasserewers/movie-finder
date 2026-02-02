import { apiFetch } from "./client";

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

export async function searchMovies(q: string, mediaType: MediaType = "movie"): Promise<{ results: Movie[] }> {
  return apiFetch(`/api/search?q=${encodeURIComponent(q)}&media_type=${mediaType}`);
}

export async function searchFiltered(
  q: string,
  providerIds: number[],
  mediaType: MediaType = "movie"
): Promise<{ results: Movie[] }> {
  const ids = providerIds.join(",");
  return apiFetch(
    `/api/search_filtered?q=${encodeURIComponent(q)}${ids ? `&provider_ids=${ids}` : ""}&media_type=${mediaType}`
  );
}

export async function getHome(
  page: number,
  pageSize: number,
  providerIds: number[],
  mediaType: MediaType = "mix",
  country?: string,
  unfiltered = false
): Promise<HomeResponse> {
  const ids = providerIds.join(",");
  const providerParam = ids ? `&provider_ids=${ids}` : (unfiltered ? "&provider_ids=," : "");
  const countryParam = country ? `&country=${encodeURIComponent(country)}` : "";
  const unfilteredParam = unfiltered ? "&unfiltered=1" : "";
  return apiFetch(
    `/api/home?page=${page}&page_size=${pageSize}${providerParam}${countryParam}${unfilteredParam}&media_type=${mediaType}`
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
  unfiltered = false
): Promise<HomeSection & { next_cursor?: string }> {
  const ids = providerIds.join(",");
  const providerParam = ids ? `&provider_ids=${ids}` : (unfiltered ? "&provider_ids=," : "");
  const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
  const countryParam = country ? `&country=${encodeURIComponent(country)}` : "";
  const unfilteredParam = unfiltered ? "&unfiltered=1" : "";
  return apiFetch(
    `/api/section?section_id=${encodeURIComponent(sectionId)}&page=${page}&pages=${pages}${providerParam}${cursorParam}${countryParam}${unfilteredParam}&media_type=${mediaType}`
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

export async function getProviders(
  country?: string
): Promise<ProviderInfo[]> {
  const url = country ? `/api/providers?country=${encodeURIComponent(country)}` : "/api/providers";
  return apiFetch(url);
}

export async function getRegions(): Promise<Region[]> {
  return apiFetch("/api/regions");
}
