const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const movieDetail = document.getElementById("movie-detail");
const homeRows = document.getElementById("home-rows");
const movieOverlay = document.getElementById("movie-overlay");
const closeMovieOverlay = document.getElementById("close-movie-overlay");
const sectionOverlay = document.getElementById("section-overlay");
const closeSectionOverlay = document.getElementById("close-section-overlay");
const sectionTitle = document.getElementById("section-title");
const sectionGrid = document.getElementById("section-grid");
const sectionLoader = document.getElementById("section-loader");
const homeLoader = document.getElementById("home-loader");
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const providerChecklist = document.getElementById("provider-checklist");
const saveSettingsBtn = document.getElementById("save-settings");
const cancelSettingsBtn = document.getElementById("cancel-settings");
const countrySearchInput = document.getElementById("country-search-input");
const countryDropdown = document.getElementById("country-dropdown");
const countryChips = document.getElementById("country-chips");
const additionalServices = document.getElementById("additional-services");
const servicesSummary = document.getElementById("services-summary");

const TMDB_IMG = "https://image.tmdb.org/t/p";
const ROW_INITIAL_COUNT = 24;
const SECTION_BATCH_PAGES = 3;
const HOME_PAGE_SIZE = 6;
let myProviderIds = new Set();
let myCountries = [];
let providerNameMap = {};
let countryNameMap = {};
let currentProviders = null;
let activeCountries = new Set();
let currentMovieTitle = "";
let currentImdbId = "";
let currentStreamingLinks = {}; // {country: [{service_id, service_name, type, link, ...}]}
let currentMovieInfo = null; // {cast, directors, rating, poster, backdrop}
let currentTmdbCredits = null; // {cast: [...], crew: [...]}
const homeSectionMap = new Map();
let sectionState = null;
let sectionSeenIds = new Set();
let sectionLoading = false;
let sectionObserver = null;
let homePage = 1;
let homeHasMore = true;
let homeLoading = false;
let homeObserver = null;

function countryFlag(code) {
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

function countryLabel(code) {
  const name = countryNameMap[code] || code;
  return `${countryFlag(code)} ${name}`;
}

// Load user config
async function loadConfig() {
  const res = await fetch("/api/config");
  const data = await res.json();
  myProviderIds = new Set(data.provider_ids || []);
  // Support legacy single country
  if (data.countries) {
    myCountries = data.countries;
  } else if (data.country) {
    myCountries = [data.country];
  } else {
    myCountries = [];
  }
}

let allRegions = [];

async function loadRegions() {
  const res = await fetch("/api/regions");
  const regions = await res.json();
  regions.sort((a, b) => a.english_name.localeCompare(b.english_name));
  allRegions = regions;
  for (const r of regions) {
    countryNameMap[r.iso_3166_1] = r.english_name;
  }
}

function renderCountryChips() {
  countryChips.innerHTML = "";
  for (const code of myCountries) {
    const chip = document.createElement("span");
    chip.className = "country-chip";
    chip.innerHTML = `${countryFlag(code)} ${esc(countryNameMap[code] || code)} <button data-code="${code}">&times;</button>`;
    chip.querySelector("button").addEventListener("click", () => removeCountry(code));
    countryChips.appendChild(chip);
  }
}

function addCountry(code) {
  if (!code || myCountries.includes(code)) return;
  myCountries.push(code);
  renderCountryChips();
  saveConfig();
  if (currentProviders) renderProviders();
}

function removeCountry(code) {
  myCountries = myCountries.filter(c => c !== code);
  renderCountryChips();
  saveConfig();
  if (currentProviders) renderProviders();
}

function renderCountryDropdown(query) {
  countryDropdown.innerHTML = "";
  const q = query.toLowerCase();
  const filtered = allRegions.filter(r =>
    !myCountries.includes(r.iso_3166_1) &&
    (r.english_name.toLowerCase().includes(q) || r.iso_3166_1.toLowerCase().includes(q))
  );
  if (!filtered.length) {
    countryDropdown.classList.add("hidden");
    return;
  }
  for (const r of filtered) {
    const div = document.createElement("div");
    div.className = "country-dropdown-item";
    div.textContent = `${countryFlag(r.iso_3166_1)} ${r.english_name}`;
    div.addEventListener("click", () => {
      addCountry(r.iso_3166_1);
      countrySearchInput.value = "";
      countryDropdown.classList.add("hidden");
    });
    countryDropdown.appendChild(div);
  }
  countryDropdown.classList.remove("hidden");
}

countrySearchInput.addEventListener("input", () => {
  const q = countrySearchInput.value.trim();
  if (q.length < 1) { renderCountryDropdown(""); return; }
  renderCountryDropdown(q);
});

countrySearchInput.addEventListener("focus", () => {
  renderCountryDropdown(countrySearchInput.value.trim());
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".country-search-wrapper")) countryDropdown.classList.add("hidden");
});

function updateServicesSummary() {
  if (!servicesSummary) return;
  servicesSummary.textContent = "";
}

// Init
async function init() {
  await Promise.all([loadConfig(), loadRegions()]);
  renderCountryChips();
  const providers = await loadProviderList();
  for (const p of providers) {
    providerNameMap[p.provider_id] = p.provider_name;
  }
  updateServicesSummary();
  await loadHomeRows(true);
}

async function saveConfig() {
  await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider_ids: Array.from(myProviderIds), countries: myCountries }),
  });
}

// Search
let searchTimeout;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  if (q.length < 2) { searchResults.classList.add("hidden"); return; }
  searchTimeout = setTimeout(() => doSearch(q), 300);
});

async function doSearch(q) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  renderSearchResults(data.results || []);
}

async function loadHomeRows(reset = false) {
  if (!homeRows) return;
  if (homeLoading) return;
  if (!homeHasMore && !reset) return;
  homeLoading = true;
  if (reset) {
    homePage = 1;
    homeHasMore = true;
    homeSectionMap.clear();
    homeRows.innerHTML = "";
  }
  updateHomeLoader(true);
  try {
    const ids = Array.from(myProviderIds);
    const qs = ids.length ? `&provider_ids=${ids.join(",")}` : "";
    const res = await fetch(`/api/home?page=${homePage}&page_size=${HOME_PAGE_SIZE}${qs}`);
    const data = await res.json();
    const sections = data.sections || [];
    renderHomeRows(sections, data.message || "", reset);
    if (typeof data.has_more === "boolean") {
      homeHasMore = data.has_more;
    } else {
      homeHasMore = sections.length > 0;
    }
    if (homeHasMore && data.next_page) {
      homePage = data.next_page;
    } else if (homeHasMore) {
      homePage += 1;
    }
  } catch (err) {
    if (reset) {
      homeRows.innerHTML = '<div class="no-results">Unable to load rows</div>';
    }
    homeHasMore = false;
  } finally {
    homeLoading = false;
    updateHomeLoader();
    setupHomeObserver();
  }
}

function renderHomeRows(sections, message, reset = false) {
  const visibleSections = (sections || []).filter(section => (section.results || []).length);
  if (!visibleSections.length && reset) {
    const msg = message || "No titles available on your selected services yet.";
    homeRows.innerHTML = `<div class="no-results">${esc(msg)}</div>`;
    return;
  }
  for (const section of visibleSections) {
    addHomeRow(section);
  }
}

function addHomeRow(section) {
  if (homeSectionMap.has(section.id)) return;
  homeSectionMap.set(section.id, section);
  const row = document.createElement("div");
  row.className = "row";
  const header = document.createElement("div");
  header.className = "row-header";
  const showMore = section.next_cursor || section.next_page || (section.total_pages && section.total_pages > 1);
  const moreBtn = showMore ? `<button class="row-more" data-section="${section.id}">See more</button>` : "";
  header.innerHTML = `<h3 class="row-title">${esc(section.title)}</h3>${moreBtn}`;
  const scroll = document.createElement("div");
  scroll.className = "row-scroll";
  renderRowItems(section, scroll);
  row.appendChild(header);
  row.appendChild(scroll);
  homeRows.appendChild(row);
}

function setupHomeObserver() {
  if (!homeLoader) return;
  if (homeObserver) {
    homeObserver.disconnect();
  }
  if (!homeHasMore) return;
  homeObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          loadHomeRows(false);
        }
      }
    },
    { root: null, threshold: 0.1 }
  );
  homeObserver.observe(homeLoader);
}

function updateHomeLoader(forceVisible = false) {
  if (!homeLoader) return;
  const shouldShow = forceVisible || homeHasMore;
  homeLoader.classList.toggle("hidden", !shouldShow);
}

function renderRowItems(section, scroll) {
  scroll.innerHTML = "";
  const list = section.results || [];
  const items = list.slice(0, ROW_INITIAL_COUNT);
  for (const m of items) {
    const card = document.createElement("div");
    card.className = "movie-card";
    card.dataset.movieId = m.id;
    const poster = m.poster_url
      ? `<img class="movie-poster" src="${esc(m.poster_url)}" alt="">`
      : m.poster_path
        ? `<img class="movie-poster" src="${TMDB_IMG}/w300${m.poster_path}" alt="">`
        : `<div class="movie-poster"></div>`;
    const year = m.release_date ? m.release_date.slice(0, 4) : "";
    card.innerHTML = `${poster}<span class="movie-card-title">${esc(m.title)}</span><span class="movie-card-year">${year}</span>`;
    scroll.appendChild(card);
  }
}

function renderSearchResults(results) {
  searchResults.innerHTML = "";
  if (!results.length) {
    searchResults.innerHTML = '<div class="no-results">No movies found</div>';
    searchResults.classList.remove("hidden");
    return;
  }
  for (const m of results.slice(0, 10)) {
    const div = document.createElement("div");
    div.className = "search-result-item";
    const year = m.release_date ? m.release_date.slice(0, 4) : "";
    const poster = m.poster_path
      ? `<img src="${TMDB_IMG}/w92${m.poster_path}" alt="">`
      : '<div class="no-poster">N/A</div>';
    div.innerHTML = `${poster}<span>${esc(m.title)}</span><span class="year">${year}</span>`;
    div.addEventListener("click", () => selectMovie(m.id));
    searchResults.appendChild(div);
  }
  searchResults.classList.remove("hidden");
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-container")) searchResults.classList.add("hidden");
});

if (homeRows) {
  homeRows.addEventListener("click", (e) => {
    const more = e.target.closest(".row-more");
    if (more) {
      const sectionId = more.dataset.section;
      openSectionOverlay(sectionId);
      return;
    }
    const card = e.target.closest(".movie-card");
    if (card && card.dataset.movieId) {
      selectMovie(card.dataset.movieId);
    }
  });
}

function openMovieOverlay() {
  if (!movieOverlay) return;
  movieOverlay.classList.remove("hidden");
  movieOverlay.setAttribute("aria-hidden", "false");
  updateBodyModalState();
  const panel = movieOverlay.querySelector(".movie-overlay-panel");
  if (panel) panel.scrollTop = 0;
}

function closeMovieOverlayFn() {
  if (!movieOverlay) return;
  movieOverlay.classList.add("hidden");
  movieOverlay.setAttribute("aria-hidden", "true");
  updateBodyModalState();
}

function updateBodyModalState() {
  const movieOpen = movieOverlay && !movieOverlay.classList.contains("hidden");
  const sectionOpen = sectionOverlay && !sectionOverlay.classList.contains("hidden");
  document.body.classList.toggle("modal-open", movieOpen || sectionOpen);
}

function openSectionOverlay(sectionId) {
  if (!sectionOverlay || !sectionGrid || !sectionTitle) return;
  const section = homeSectionMap.get(sectionId);
  if (!section) return;
  const useCursor = Object.prototype.hasOwnProperty.call(section, "next_cursor");
  sectionState = {
    id: section.id,
    title: section.title,
    useCursor,
    nextCursor: null,
    nextPage: useCursor ? null : 1,
    totalPages: section.total_pages || 0,
    hasMore: true,
  };
  sectionSeenIds = new Set();
  sectionTitle.textContent = section.title;
  sectionGrid.innerHTML = "";
  sectionOverlay.classList.remove("hidden");
  sectionOverlay.setAttribute("aria-hidden", "false");
  updateSectionLoader();
  updateBodyModalState();
  const panel = sectionOverlay.querySelector(".section-overlay-panel");
  if (panel) panel.scrollTop = 0;
  setupSectionObserver(panel);
  loadMoreSection(true);
}

function closeSectionOverlayFn() {
  if (!sectionOverlay) return;
  sectionOverlay.classList.add("hidden");
  sectionOverlay.setAttribute("aria-hidden", "true");
  if (sectionObserver) {
    sectionObserver.disconnect();
  }
  updateBodyModalState();
}

function renderSectionGridItems(items) {
  if (!sectionGrid) return;
  for (const m of items) {
    const mid = m.id;
    if (mid && sectionSeenIds.has(mid)) continue;
    if (mid) sectionSeenIds.add(mid);
    const card = document.createElement("div");
    card.className = "movie-card";
    card.dataset.movieId = m.id;
    const poster = m.poster_url
      ? `<img class="movie-poster" src="${esc(m.poster_url)}" alt="">`
      : m.poster_path
        ? `<img class="movie-poster" src="${TMDB_IMG}/w300${m.poster_path}" alt="">`
        : `<div class="movie-poster"></div>`;
    const year = m.release_date ? m.release_date.slice(0, 4) : "";
    card.innerHTML = `${poster}<span class="movie-card-title">${esc(m.title)}</span><span class="movie-card-year">${year}</span>`;
    sectionGrid.appendChild(card);
  }
}

async function loadMoreSection(reset = false) {
  if (!sectionState || sectionLoading) return;
  if (sectionState.useCursor) {
    if (sectionState.hasMore === false) return;
  } else if (!sectionState.nextPage) {
    return;
  }
  sectionLoading = true;
  updateSectionLoader(true);
  try {
    const ids = Array.from(myProviderIds);
    const qs = ids.length ? `&provider_ids=${ids.join(",")}` : "";
    const cursor = sectionState.useCursor && sectionState.nextCursor ? `&cursor=${encodeURIComponent(sectionState.nextCursor)}` : "";
    const page = sectionState.useCursor ? 1 : sectionState.nextPage;
    const res = await fetch(`/api/section?section_id=${encodeURIComponent(sectionState.id)}&page=${page}&pages=${SECTION_BATCH_PAGES}${cursor}${qs}`);
    const data = await res.json();
    if (reset) {
      sectionGrid.innerHTML = "";
      sectionSeenIds = new Set();
    }
    renderSectionGridItems(data.results || []);
    if (sectionState.useCursor) {
      sectionState.nextCursor = data.next_cursor || null;
      sectionState.hasMore = Boolean(sectionState.nextCursor);
    } else {
      sectionState.totalPages = data.total_pages || sectionState.totalPages;
      sectionState.nextPage = data.next_page || null;
      sectionState.hasMore = Boolean(sectionState.nextPage);
    }
  } catch (err) {
    sectionState.hasMore = false;
  } finally {
    sectionLoading = false;
    updateSectionLoader();
  }
}

function updateSectionLoader(forceVisible = false) {
  if (!sectionLoader) return;
  const shouldShow = forceVisible || (sectionState && sectionState.hasMore);
  sectionLoader.classList.toggle("hidden", !shouldShow);
}

function setupSectionObserver(panel) {
  if (!sectionLoader || !panel) return;
  if (sectionObserver) {
    sectionObserver.disconnect();
  }
  sectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          loadMoreSection();
        }
      }
    },
    { root: panel, threshold: 0.1 }
  );
  sectionObserver.observe(sectionLoader);
}

if (closeMovieOverlay) {
  closeMovieOverlay.addEventListener("click", closeMovieOverlayFn);
}

if (movieOverlay) {
  movieOverlay.addEventListener("click", (e) => {
    if (e.target.classList.contains("movie-overlay-backdrop")) closeMovieOverlayFn();
  });
}

if (closeSectionOverlay) {
  closeSectionOverlay.addEventListener("click", closeSectionOverlayFn);
}

if (sectionOverlay) {
  sectionOverlay.addEventListener("click", (e) => {
    if (e.target.classList.contains("movie-overlay-backdrop")) closeSectionOverlayFn();
  });
}

if (sectionGrid) {
  sectionGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".movie-card");
    if (card && card.dataset.movieId) {
      selectMovie(card.dataset.movieId);
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && movieOverlay && !movieOverlay.classList.contains("hidden")) {
    closeMovieOverlayFn();
    return;
  }
  if (e.key === "Escape" && sectionOverlay && !sectionOverlay.classList.contains("hidden")) {
    closeSectionOverlayFn();
  }
});

// Select movie
async function selectMovie(movieId) {
  searchResults.classList.add("hidden");
  const [provRes, linksRes] = await Promise.all([
    fetch(`/api/movie/${movieId}/providers`),
    fetch(`/api/movie/${movieId}/links`).catch(() => null),
  ]);
  const data = await provRes.json();
  const movie = data.movie;
  currentProviders = data.providers;
  const linksData = linksRes ? await linksRes.json() : {};
  currentStreamingLinks = linksData.streaming || {};
  currentMovieInfo = linksData.movie_info || null;

  currentTmdbCredits = movie.credits || null;
  currentMovieTitle = movie.title;
  currentImdbId = movie.imdb_id || "";
  document.getElementById("movie-title").textContent = movie.title;
  document.getElementById("movie-year").textContent = movie.release_date ? movie.release_date.slice(0, 4) : "";
  document.getElementById("movie-overview").textContent = movie.overview || "";

  const poster = document.getElementById("movie-poster");
  const posterUrl = (currentMovieInfo && currentMovieInfo.poster) || (movie.poster_path ? `${TMDB_IMG}/w300${movie.poster_path}` : "");
  if (posterUrl) {
    poster.src = posterUrl;
    poster.style.display = "";
  } else {
    poster.style.display = "none";
  }

  // Render enriched movie meta (rating, cast, directors)
  renderMovieMeta();

  renderProviders();
  openMovieOverlay();
}

function renderPersonCircle(person) {
  const img = person.profile_path
    ? `<img src="${TMDB_IMG}/w185${person.profile_path}" alt="">`
    : `<div class="person-placeholder"></div>`;
  const role = person.character ? `<span class="person-role">${esc(person.character)}</span>` : "";
  return `<div class="person-circle">${img}<span class="person-name">${esc(person.name)}</span>${role}</div>`;
}

function renderMovieMeta() {
  const el = document.getElementById("movie-meta");
  const credits = currentTmdbCredits;
  if (!credits) { el.innerHTML = ""; return; }

  const cast = credits.cast || [];
  const crew = credits.crew || [];
  const directors = crew.filter(c => c.job === "Director");
  const topCast = cast.slice(0, 6);

  // Show directors + top cast inline, with a "Cast & Crew" button
  let html = "";
  if (directors.length || topCast.length) {
    html += `<div class="people-inline">`;
    if (directors.length) {
      html += `<div class="people-section"><h4 class="section-label">Director${directors.length > 1 ? "s" : ""}</h4><div class="people-row inline-row">${directors.map(renderPersonCircle).join("")}</div></div>`;
    }
    if (topCast.length) {
      html += `<div class="people-section"><h4 class="section-label">Cast</h4><div class="people-row inline-row">${topCast.map(renderPersonCircle).join("")}</div></div>`;
    }
    html += `</div>`;
  }
  if (cast.length > 6 || crew.length) {
    html += `<button id="open-credits-btn" class="credits-btn">Cast & Crew</button>`;
  }
  el.innerHTML = html;

  const btn = document.getElementById("open-credits-btn");
  if (btn) btn.addEventListener("click", () => openCreditsModal(credits));
}

function openCreditsModal(credits) {
  const cast = credits.cast || [];
  const crew = credits.crew || [];
  const directors = crew.filter(c => c.job === "Director");
  const writers = crew.filter(c => ["Writer", "Screenplay", "Story"].includes(c.job));
  const producers = crew.filter(c => c.job === "Producer" || c.job === "Executive Producer");
  const otherCrew = crew.filter(c => !["Director", "Writer", "Screenplay", "Story", "Producer", "Executive Producer"].includes(c.job));

  // Deduplicate crew by id+job
  function dedup(arr) {
    const seen = new Set();
    return arr.filter(c => { const k = c.id + ":" + c.job; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  const tabs = [];
  if (cast.length) tabs.push({ id: "cast", label: "Cast", people: cast, showRole: true });
  const filmmakerSections = [
    { label: `Director${directors.length > 1 ? "s" : ""}`, people: directors, showRole: false },
    { label: "Writers", people: dedup(writers), showRole: true, roleField: "job" },
    { label: "Producers", people: dedup(producers), showRole: true, roleField: "job" }
  ].filter(section => section.people.length);
  if (filmmakerSections.length) {
    tabs.push({ id: "filmmakers", label: "Filmmakers", sections: filmmakerSections });
  }
  if (otherCrew.length) tabs.push({ id: "crew", label: "Additional Crew", people: dedup(otherCrew), showRole: true, roleField: "job" });

  let html = `<div class="credits-tabs">`;
  for (const tab of tabs) {
    html += `<button class="credits-tab${tab === tabs[0] ? " active" : ""}" data-tab="${tab.id}">${tab.label}</button>`;
  }
  html += `</div>`;

  for (const tab of tabs) {
    html += `<div class="credits-panel${tab === tabs[0] ? "" : " hidden"}" data-panel="${tab.id}">`;
    if (tab.sections) {
      for (const section of tab.sections) {
        html += `<div class="people-section"><h4 class="section-label">${section.label}</h4><div class="people-row">`;
        for (const p of section.people) {
          const img = p.profile_path
            ? `<img src="${TMDB_IMG}/w185${p.profile_path}" alt="">`
            : `<div class="person-placeholder"></div>`;
          const role = section.showRole ? `<span class="person-role">${esc(section.roleField ? (p[section.roleField] || "") : (p.character || ""))}</span>` : "";
          html += `<div class="person-circle">${img}<span class="person-name">${esc(p.name)}</span>${role}</div>`;
        }
        html += `</div></div>`;
      }
    } else {
      html += `<div class="people-row">`;
      for (const p of tab.people) {
        const img = p.profile_path
          ? `<img src="${TMDB_IMG}/w185${p.profile_path}" alt="">`
          : `<div class="person-placeholder"></div>`;
        const role = tab.showRole ? `<span class="person-role">${esc(tab.roleField ? (p[tab.roleField] || "") : (p.character || ""))}</span>` : "";
        html += `<div class="person-circle">${img}<span class="person-name">${esc(p.name)}</span>${role}</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }

  const modal = document.getElementById("credits-modal");
  document.getElementById("credits-content").innerHTML = html;
  modal.classList.remove("hidden");

  // Close button
  document.getElementById("close-credits").addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

  // Tab switching
  for (const btn of modal.querySelectorAll(".credits-tab")) {
    btn.addEventListener("click", () => {
      modal.querySelectorAll(".credits-tab").forEach(b => b.classList.remove("active"));
      modal.querySelectorAll(".credits-panel").forEach(p => p.classList.add("hidden"));
      btn.classList.add("active");
      modal.querySelector(`[data-panel="${btn.dataset.tab}"]`).classList.remove("hidden");
    });
  }
}

function renderProviders() {
  const container = document.getElementById("providers-table-container");
  if (!currentProviders || !Object.keys(currentProviders).length) {
    container.innerHTML = '<div class="no-results">No streaming data available for this movie</div>';
    return;
  }

  let html = "";
  const myCountrySet = new Set(myCountries);

  // Show each of the user's countries
  for (const code of myCountries) {
    const countryData = currentProviders[code];
    if (countryData) {
      html += `<h3>Available in ${countryLabel(code)}</h3>`;

      const link = countryData.link || "";

      const streaming = [];
      for (const type of ["flatrate", "free", "ads"]) {
        if (!countryData[type]) continue;
        for (const p of countryData[type]) {
          streaming.push({ ...p, type, isMine: myProviderIds.has(p.provider_id), link });
        }
      }

      const rentBuyMap = {};
      for (const type of ["rent", "buy"]) {
        if (!countryData[type]) continue;
        for (const p of countryData[type]) {
          if (rentBuyMap[p.provider_id]) {
            rentBuyMap[p.provider_id].type = "rent/buy";
          } else {
            rentBuyMap[p.provider_id] = { ...p, type, isMine: myProviderIds.has(p.provider_id), link };
          }
        }
      }
      const rentBuy = Object.values(rentBuyMap);

      if (streaming.length) {
        html += `<h4 class="section-label">Stream</h4>`;
        html += renderProviderGrid(streaming, code);
      }
      if (rentBuy.length) {
        html += `<h4 class="section-label">Rent / Buy</h4>`;
        html += renderProviderGrid(rentBuy, code);
      }
      if (!streaming.length && !rentBuy.length) {
        html += '<div class="no-results">No streaming data for this country</div>';
      }
    } else {
      html += `<div class="not-available">Not available in ${countryLabel(code)}</div>`;
    }
  }

  // Other countries where my services have it
  const otherMyRows = [];
  const otherRestRows = [];
  for (const [country, data] of Object.entries(currentProviders)) {
    if (myCountrySet.has(country)) continue;
    const myServices = [];
    for (const type of ["flatrate", "free", "ads"]) {
      if (!data[type]) continue;
      for (const p of data[type]) {
        if (myProviderIds.has(p.provider_id)) {
          myServices.push({ ...p, type });
        }
      }
    }
    if (myServices.length) otherMyRows.push({ country, providers: myServices });

    // Other services + rent/buy in other countries
    const otherServices = [];
    for (const type of ["flatrate", "free", "ads"]) {
      if (!data[type]) continue;
      for (const p of data[type]) {
        if (!myProviderIds.has(p.provider_id)) {
          otherServices.push({ ...p, type });
        }
      }
    }
    const rbMap = {};
    for (const type of ["rent", "buy"]) {
      if (!data[type]) continue;
      for (const p of data[type]) {
        if (rbMap[p.provider_id]) {
          rbMap[p.provider_id].type = "rent/buy";
        } else {
          rbMap[p.provider_id] = { ...p, type };
        }
      }
    }
    const rb = Object.values(rbMap);
    if (otherServices.length || rb.length) {
      otherRestRows.push({ country, streaming: otherServices, rentBuy: rb });
    }
  }

  if (otherMyRows.length) {
    otherMyRows.sort((a, b) => a.country.localeCompare(b.country));
    html += `<details class="other-countries"><summary>Available on your services in ${otherMyRows.length} other ${otherMyRows.length === 1 ? "country" : "countries"}</summary>`;
    html += renderCountryTable(otherMyRows);
    html += `</details>`;
  }

  if (otherRestRows.length) {
    otherRestRows.sort((a, b) => a.country.localeCompare(b.country));
    html += `<details class="other-options"><summary>Available on other services or to rent/buy in ${otherRestRows.length} other ${otherRestRows.length === 1 ? "country" : "countries"}</summary>`;
    html += renderOtherCountryTable(otherRestRows);
    html += `</details>`;
  }

  if (!html) {
    html = '<div class="no-results">No streaming data available for this movie</div>';
  }

  container.innerHTML = html;

}

function extractDeep(l) {
  return {
    link: l.link, quality: l.quality,
    price: l.price || "", audios: l.audios || [], subtitles: l.subtitles || [],
    expires_on: l.expires_on || 0,
  };
}

function findDeepLink(providerName, countryCode, type) {
  const links = currentStreamingLinks[countryCode.toLowerCase()];
  if (!links) return null;
  const nameNorm = providerName.toLowerCase();
  for (const l of links) {
    if (l.service_name.toLowerCase() !== nameNorm) continue;
    if (["flatrate", "free", "ads"].includes(type)) {
      if (["subscription", "free", "addon"].includes(l.type)) return extractDeep(l);
    }
    if (type === "rent" || type === "buy" || type === "rent/buy") {
      if (l.type === "rent" || l.type === "buy") return extractDeep(l);
    }
  }
  for (const l of links) {
    if (l.service_name.toLowerCase() === nameNorm) return extractDeep(l);
  }
  return null;
}

const QUALITY_LABELS = { uhd: "4K", qhd: "1440p", hd: "HD", sd: "SD" };

function renderProviderGrid(providers, countryCode) {
  providers.sort((a, b) => (b.isMine ? 1 : 0) - (a.isMine ? 1 : 0));
  return '<div class="provider-grid">' + providers.map(p => {
    const logo = p.logo_path ? `<img class="provider-logo-lg" src="${TMDB_IMG}/w92${p.logo_path}" alt="">` : "";
    let cls = "provider-card";
    if (p.type === "buy") cls += " buy";
    else if (p.type === "rent" || p.type === "rent/buy") cls += " rent";
    else if (p.isMine) cls += " mine";
    else cls += " other";
    const typeLabel = p.type === "flatrate" ? "stream" : p.type;
    const deep = countryCode ? findDeepLink(p.provider_name, countryCode, p.type) : null;
    const href = (deep && deep.link) || p.link || "";
    // Quality badge
    const qualityTag = deep && deep.quality && QUALITY_LABELS[deep.quality]
      ? `<span class="quality-badge">${QUALITY_LABELS[deep.quality]}</span>` : "";
    // Price
    const priceTag = deep && deep.price
      ? `<span class="price-label">${esc(deep.price)}</span>` : "";
    // Expiring warning
    let expiringTag = "";
    if (deep && deep.expires_on) {
      const daysLeft = Math.ceil((deep.expires_on * 1000 - Date.now()) / 86400000);
      if (daysLeft > 0 && daysLeft <= 30) {
        expiringTag = `<span class="expiring-badge">Leaving in ${daysLeft}d</span>`;
      }
    }
    // Languages (compact)
    let langTag = "";
    if (deep && deep.audios && deep.audios.length) {
      const langs = deep.audios.slice(0, 3).map(l => l.toUpperCase()).join(" ");
      langTag = `<span class="lang-tags">${langs}</span>`;
    }
    const extras = [qualityTag, priceTag, expiringTag, langTag].filter(Boolean).join("");
    const inner = `${logo}<span class="provider-card-name">${esc(p.provider_name)}</span><span class="type-label">${typeLabel}</span>${extras}`;
    if (href) {
      return `<a href="${esc(href)}" target="_blank" rel="noopener" class="${cls}">${inner}</a>`;
    }
    return `<div class="${cls}">${inner}</div>`;
  }).join("") + '</div>';
}

function renderOtherCountryTable(rows) {
  let html = "<table><thead><tr><th>Country</th><th>Available On</th></tr></thead><tbody>";
  for (const row of rows) {
    const allProviders = [
      ...row.streaming.map(p => ({ ...p, cls: "provider-tag other" })),
      ...row.rentBuy.map(p => ({ ...p, cls: p.type === "buy" ? "provider-tag buy" : "provider-tag rent" })),
    ];
    const tags = allProviders.map(p => {
      const logo = p.logo_path ? `<img class="provider-logo" src="${TMDB_IMG}/w45${p.logo_path}" alt="">` : "";
      const typeLabel = p.type === "flatrate" ? "stream" : p.type;
      return `<span class="${p.cls}">${logo}${esc(p.provider_name)} <span class="type-label">${typeLabel}</span></span>`;
    }).join("");
    html += `<tr><td>${countryLabel(row.country)}</td><td>${tags}</td></tr>`;
  }
  html += "</tbody></table>";
  return html;
}

function renderCountryTable(rows) {
  let html = "<table><thead><tr><th>Country</th><th>Available On</th></tr></thead><tbody>";
  for (const row of rows) {
    const tags = row.providers.map(p => {
      const logo = p.logo_path ? `<img class="provider-logo" src="${TMDB_IMG}/w45${p.logo_path}" alt="">` : "";
      const typeLabel = p.type === "flatrate" ? "stream" : p.type;
      return `<span class="provider-tag mine">${logo}${esc(p.provider_name)} <span class="type-label">${typeLabel}</span></span>`;
    }).join("");
    html += `<tr><td>${countryLabel(row.country)}</td><td>${tags}</td></tr>`;
  }
  html += "</tbody></table>";
  return html;
}

// Settings modal
const providerSearch = document.getElementById("provider-search");

providerSearch.addEventListener("input", () => {
  const q = providerSearch.value.toLowerCase();
  for (const label of providerChecklist.querySelectorAll("label")) {
    const name = label.textContent.toLowerCase();
    label.style.display = name.includes(q) ? "" : "none";
  }
});

async function loadProviderList(country) {
  const url = country ? `/api/providers?country=${encodeURIComponent(country)}` : "/api/providers";
  const res = await fetch(url);
  return await res.json();
}

// Find related providers: any provider whose name starts with this one's name,
// or whose name this one starts with (e.g. "Netflix" matches "Netflix Kids")
function findRelatedIds(changedProvider, providers) {
  const name = changedProvider.provider_name.toLowerCase();
  const ids = [];
  for (const p of providers) {
    const other = p.provider_name.toLowerCase();
    if (other.startsWith(name) || name.startsWith(other)) {
      ids.push(p.provider_id);
    }
  }
  return ids;
}

function onProviderToggle(changedId, checked, providers) {
  if (!checked) return;
  const changedProvider = providers.find(p => p.provider_id === changedId);
  if (!changedProvider) return;
  const related = findRelatedIds(changedProvider, providers);
  for (const id of related) {
    const cb = providerChecklist.querySelector(`input[value="${id}"]`);
    if (cb && !cb.checked) {
      cb.checked = true;
    }
  }
}

let currentModalProviders = [];

function renderProviderChecklist(providers) {
  providerChecklist.innerHTML = "";
  currentModalProviders = providers;
  providers.sort((a, b) => a.provider_name.localeCompare(b.provider_name));
  for (const p of providers) {
    providerNameMap[p.provider_id] = p.provider_name;
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = p.provider_id;
    cb.checked = myProviderIds.has(p.provider_id);
    cb.addEventListener("change", () => {
      onProviderToggle(p.provider_id, cb.checked, providers);
    });
    label.appendChild(cb);
    if (p.logo_path) {
      const img = document.createElement("img");
      img.src = `${TMDB_IMG}/w45${p.logo_path}`;
      img.className = "provider-logo";
      label.appendChild(img);
    }
    label.appendChild(document.createTextNode(p.provider_name));
    providerChecklist.appendChild(label);
  }
}

const modalCountryFilters = document.getElementById("modal-country-filters");

function renderModalCountryFilters() {
  modalCountryFilters.innerHTML = "";
  if (myCountries.length < 2) return;
  for (const code of myCountries) {
    const btn = document.createElement("button");
    btn.className = "country-filter-btn" + (activeCountries.has(code) ? " active" : "");
    btn.dataset.country = code;
    btn.textContent = `${countryFlag(code)} ${countryNameMap[code] || code}`;
    btn.addEventListener("click", () => {
      if (activeCountries.has(code)) {
        if (activeCountries.size <= 1) return;
        activeCountries.delete(code);
      } else {
        activeCountries.add(code);
      }
      renderModalCountryFilters();
      reloadModalProviders();
    });
    modalCountryFilters.appendChild(btn);
  }
}

async function reloadModalProviders() {
  const countries = myCountries.filter(c => activeCountries.has(c));
  const providers = additionalServices.checked
    ? await loadProviderList()
    : countries.length
      ? await loadCombinedProviders(countries)
      : await loadProviderList();
  renderProviderChecklist(providers);
}

const additionalToggle = additionalServices.closest(".additional-toggle");

settingsBtn.addEventListener("click", async () => {
  additionalServices.checked = false;
  providerSearch.value = "";
  activeCountries = new Set(myCountries);
  renderModalCountryFilters();
  additionalToggle.style.display = myCountries.length ? "" : "none";
  const providers = myCountries.length
    ? await loadCombinedProviders(myCountries)
    : await loadProviderList();
  renderProviderChecklist(providers);
  settingsModal.classList.remove("hidden");
});

async function loadCombinedProviders(countries) {
  const lists = await Promise.all(countries.map(c => loadProviderList(c)));
  const seen = new Set();
  const combined = [];
  for (const list of lists) {
    for (const p of list) {
      if (!seen.has(p.provider_id)) {
        seen.add(p.provider_id);
        combined.push(p);
      }
    }
  }
  return combined;
}

additionalServices.addEventListener("change", () => reloadModalProviders());

document.getElementById("deselect-all").addEventListener("click", () => {
  for (const cb of providerChecklist.querySelectorAll("input[type=checkbox]")) {
    cb.checked = false;
  }
});

cancelSettingsBtn.addEventListener("click", () => settingsModal.classList.add("hidden"));

saveSettingsBtn.addEventListener("click", async () => {
  const checked = providerChecklist.querySelectorAll("input:checked");
  const ids = Array.from(checked).map(cb => parseInt(cb.value));
  myProviderIds = new Set(ids);
  await saveConfig();
  updateServicesSummary();
  settingsModal.classList.add("hidden");
  await loadHomeRows(true);
  if (currentProviders) renderProviders();
});

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

init();
