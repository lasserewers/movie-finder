const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const movieDetail = document.getElementById("movie-detail");
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
let myProviderIds = new Set();
let myCountries = [];
let providerNameMap = {};
let countryNameMap = {};
let currentProviders = null;
let activeCountries = new Set();

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
  for (const r of filtered.slice(0, 10)) {
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
  renderCountryChips();
  const providers = await loadProviderList();
  for (const p of providers) {
    providerNameMap[p.provider_id] = p.provider_name;
  }
  updateServicesSummary();
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

      const streaming = [];
      for (const type of ["flatrate", "free", "ads"]) {
        if (!countryData[type]) continue;
        for (const p of countryData[type]) {
          streaming.push({ ...p, type, isMine: myProviderIds.has(p.provider_id) });
        }
      }

      const rentBuyMap = {};
      for (const type of ["rent", "buy"]) {
        if (!countryData[type]) continue;
        for (const p of countryData[type]) {
          if (rentBuyMap[p.provider_id]) {
            rentBuyMap[p.provider_id].type = "rent/buy";
          } else {
            rentBuyMap[p.provider_id] = { ...p, type, isMine: myProviderIds.has(p.provider_id) };
          }
        }
      }
      const rentBuy = Object.values(rentBuyMap);

      if (streaming.length) {
        html += `<h4 class="section-label">Stream</h4>`;
        html += renderProviderGrid(streaming);
      }
      if (rentBuy.length) {
        html += `<h4 class="section-label">Rent / Buy</h4>`;
        html += renderProviderGrid(rentBuy);
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

function renderProviderGrid(providers) {
  providers.sort((a, b) => (b.isMine ? 1 : 0) - (a.isMine ? 1 : 0));
  return '<div class="provider-grid">' + providers.map(p => {
    const logo = p.logo_path ? `<img class="provider-logo-lg" src="${TMDB_IMG}/w92${p.logo_path}" alt="">` : "";
    let cls = "provider-card";
    if (p.type === "buy") cls += " buy";
    else if (p.type === "rent" || p.type === "rent/buy") cls += " rent";
    else if (p.isMine) cls += " mine";
    else cls += " other";
    const typeLabel = p.type === "flatrate" ? "stream" : p.type;
    return `<div class="${cls}">${logo}<span class="provider-card-name">${esc(p.provider_name)}</span><span class="type-label">${typeLabel}</span></div>`;
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
  if (currentProviders) renderProviders();
});

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

init();
