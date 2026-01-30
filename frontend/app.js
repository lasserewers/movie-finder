const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const movieDetail = document.getElementById("movie-detail");
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const providerChecklist = document.getElementById("provider-checklist");
const saveSettingsBtn = document.getElementById("save-settings");
const cancelSettingsBtn = document.getElementById("cancel-settings");
const countrySelect = document.getElementById("country-select");
const additionalServices = document.getElementById("additional-services");
const servicesSummary = document.getElementById("services-summary");

const TMDB_IMG = "https://image.tmdb.org/t/p";
let myProviderIds = new Set();
let myCountry = "";
let providerNameMap = {}; // provider_id -> name
let currentProviders = null;

// Load user config
async function loadConfig() {
  const res = await fetch("/api/config");
  const data = await res.json();
  myProviderIds = new Set(data.provider_ids || []);
  myCountry = data.country || "";
}

// Load regions and populate country dropdown
async function loadRegions() {
  const res = await fetch("/api/regions");
  const regions = await res.json();
  regions.sort((a, b) => a.english_name.localeCompare(b.english_name));
  for (const r of regions) {
    const opt = document.createElement("option");
    opt.value = r.iso_3166_1;
    opt.textContent = r.english_name;
    countrySelect.appendChild(opt);
  }
}

function updateServicesSummary() {
  if (!myProviderIds.size) {
    servicesSummary.textContent = "None selected";
    return;
  }
  const names = Array.from(myProviderIds)
    .map(id => providerNameMap[id])
    .filter(Boolean)
    .sort();
  if (names.length <= 3) {
    servicesSummary.textContent = names.join(", ");
  } else {
    servicesSummary.textContent = names.slice(0, 3).join(", ") + ` +${names.length - 3} more`;
  }
}

// Init
async function init() {
  await Promise.all([loadConfig(), loadRegions()]);
  if (myCountry) {
    countrySelect.value = myCountry;
  }
  // Load providers to build name map for summary
  const providers = await loadProviderList();
  for (const p of providers) {
    providerNameMap[p.provider_id] = p.provider_name;
  }
  updateServicesSummary();
}

countrySelect.addEventListener("change", async () => {
  myCountry = countrySelect.value;
  await saveConfig();
  if (currentProviders) renderProviders();
});

async function saveConfig() {
  await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider_ids: Array.from(myProviderIds), country: myCountry }),
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

// Select movie
async function selectMovie(movieId) {
  searchResults.classList.add("hidden");
  const res = await fetch(`/api/movie/${movieId}/providers`);
  const data = await res.json();
  const movie = data.movie;
  currentProviders = data.providers;

  document.getElementById("movie-title").textContent = movie.title;
  document.getElementById("movie-year").textContent = movie.release_date ? movie.release_date.slice(0, 4) : "";
  document.getElementById("movie-overview").textContent = movie.overview || "";

  const poster = document.getElementById("movie-poster");
  if (movie.poster_path) {
    poster.src = `${TMDB_IMG}/w300${movie.poster_path}`;
    poster.style.display = "";
  } else {
    poster.style.display = "none";
  }

  movieDetail.classList.remove("hidden");
  renderProviders();
}

// Render providers:
// 1. If available on my services in my country → show that
// 2. Otherwise → show other countries where it's available on my services
function renderProviders() {
  const container = document.getElementById("providers-table-container");
  if (!currentProviders || !Object.keys(currentProviders).length) {
    container.innerHTML = '<div class="no-results">No streaming data available for this movie</div>';
    return;
  }

  // Collect rows where my services are available
  const myCountryRows = [];
  const otherCountryRows = [];

  for (const [country, data] of Object.entries(currentProviders)) {
    const myServices = [];
    for (const type of ["flatrate", "free", "ads"]) {
      if (!data[type]) continue;
      for (const p of data[type]) {
        if (myProviderIds.has(p.provider_id)) {
          myServices.push({ ...p, type });
        }
      }
    }
    if (!myServices.length) continue;

    const row = { country, link: data.link, providers: myServices };
    if (myCountry && country === myCountry) {
      myCountryRows.push(row);
    } else {
      otherCountryRows.push(row);
    }
  }

  // Case 1: available in my country on my services
  if (myCountryRows.length) {
    let html = `<h3>Available on your services in ${esc(myCountry)}</h3>`;
    html += renderProviderTags(myCountryRows[0].providers);

    // Also show other countries as a collapsed section
    if (otherCountryRows.length) {
      otherCountryRows.sort((a, b) => a.country.localeCompare(b.country));
      html += `<details class="other-countries"><summary>Also available in ${otherCountryRows.length} other ${otherCountryRows.length === 1 ? "country" : "countries"}</summary>`;
      html += renderCountryTable(otherCountryRows);
      html += `</details>`;
    }
    container.innerHTML = html;
    return;
  }

  // Case 2: not in my country, but available elsewhere on my services
  if (otherCountryRows.length) {
    otherCountryRows.sort((a, b) => a.country.localeCompare(b.country));
    let html = `<div class="not-available">Not available on your services in ${esc(myCountry || "your country")}</div>`;
    html += `<h3>Available on your services in other countries</h3>`;
    html += renderCountryTable(otherCountryRows);
    container.innerHTML = html;
    return;
  }

  // Case 3: not available on any of my services anywhere
  container.innerHTML = '<div class="no-results">Not available on any of your selected services</div>';
}

function renderProviderTags(providers) {
  return '<div class="provider-tags">' + providers.map(p => {
    const logo = p.logo_path ? `<img class="provider-logo" src="${TMDB_IMG}/w45${p.logo_path}" alt="">` : "";
    const typeLabel = p.type === "flatrate" ? "stream" : p.type;
    return `<span class="provider-tag mine">${logo}${esc(p.provider_name)} <span class="type-label">${typeLabel}</span></span>`;
  }).join("") + '</div>';
}

function renderCountryTable(rows) {
  let html = "<table><thead><tr><th>Country</th><th>Available On</th></tr></thead><tbody>";
  for (const row of rows) {
    const tags = row.providers.map(p => {
      const logo = p.logo_path ? `<img class="provider-logo" src="${TMDB_IMG}/w45${p.logo_path}" alt="">` : "";
      const typeLabel = p.type === "flatrate" ? "stream" : p.type;
      return `<span class="provider-tag mine">${logo}${esc(p.provider_name)} <span class="type-label">${typeLabel}</span></span>`;
    }).join("");
    html += `<tr><td>${esc(row.country)}</td><td>${tags}</td></tr>`;
  }
  html += "</tbody></table>";
  return html;
}

// Settings modal
async function loadProviderList(country) {
  const url = country ? `/api/providers?country=${encodeURIComponent(country)}` : "/api/providers";
  const res = await fetch(url);
  return await res.json();
}

function renderProviderChecklist(providers) {
  providerChecklist.innerHTML = "";
  providers.sort((a, b) => a.provider_name.localeCompare(b.provider_name));
  for (const p of providers) {
    providerNameMap[p.provider_id] = p.provider_name;
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = p.provider_id;
    cb.checked = myProviderIds.has(p.provider_id);
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

settingsBtn.addEventListener("click", async () => {
  additionalServices.checked = false;
  const providers = myCountry ? await loadProviderList(myCountry) : await loadProviderList();
  renderProviderChecklist(providers);
  settingsModal.classList.remove("hidden");
});

additionalServices.addEventListener("change", async () => {
  const providers = additionalServices.checked
    ? await loadProviderList()
    : await loadProviderList(myCountry || null);
  renderProviderChecklist(providers);
});

cancelSettingsBtn.addEventListener("click", () => settingsModal.classList.add("hidden"));

saveSettingsBtn.addEventListener("click", async () => {
  const checked = providerChecklist.querySelectorAll("input:checked");
  const ids = Array.from(checked).map(cb => parseInt(cb.value));
  myProviderIds = new Set(ids);
  await saveConfig();
  updateServicesSummary();
  settingsModal.classList.add("hidden");
  if (currentProviders) renderProviders();
});

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

init();
