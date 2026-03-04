"""Plex API client for OAuth, server discovery, and library fetching."""

import asyncio
import os
import re
import httpx

PLEX_CLIENT_ID = os.environ.get("PLEX_CLIENT_IDENTIFIER", "movie-finder-plex-integration")
PLEX_PRODUCT = os.environ.get("PLEX_PRODUCT_NAME", "FullStreamer")

PLEX_HEADERS = {
    "X-Plex-Client-Identifier": PLEX_CLIENT_ID,
    "X-Plex-Product": PLEX_PRODUCT,
    "Accept": "application/json",
}

_client: httpx.AsyncClient | None = None

_TMDB_GUID_RE = re.compile(r"tmdb://(\d+)")
_LEGACY_TMDB_RE = re.compile(r"com\.plexapp\.agents\.themoviedb://(\d+)")


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=15)
    return _client


async def close_client():
    global _client
    if _client:
        await _client.aclose()
        _client = None


# ---------------------------------------------------------------------------
# OAuth PIN flow
# ---------------------------------------------------------------------------

async def create_pin() -> dict:
    """POST plex.tv/api/v2/pins -> {pin_id, code}."""
    client = await _get_client()
    resp = await client.post(
        "https://plex.tv/api/v2/pins",
        headers=PLEX_HEADERS,
        data={"strong": "true"},
    )
    resp.raise_for_status()
    data = resp.json()
    return {"pin_id": data["id"], "code": data["code"]}


def build_auth_url(code: str, redirect_uri: str) -> str:
    """Build the Plex OAuth redirect URL."""
    from urllib.parse import quote
    return (
        f"https://app.plex.tv/auth#?"
        f"clientID={PLEX_CLIENT_ID}&code={code}"
        f"&forwardUrl={quote(redirect_uri, safe='')}"
        f"&context%5Bdevice%5D%5Bproduct%5D={quote(PLEX_PRODUCT, safe='')}"
    )


async def check_pin(pin_id: int) -> str | None:
    """Poll GET plex.tv/api/v2/pins/{id} -> authToken or None."""
    client = await _get_client()
    resp = await client.get(
        f"https://plex.tv/api/v2/pins/{pin_id}",
        headers=PLEX_HEADERS,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("authToken")
    return token if token else None


# ---------------------------------------------------------------------------
# Server + library discovery
# ---------------------------------------------------------------------------

async def get_servers(plex_token: str) -> list[dict]:
    """Returns list of {name, machine_id, access_token, uri}."""
    client = await _get_client()
    resp = await client.get(
        "https://plex.tv/api/v2/resources",
        headers={**PLEX_HEADERS, "X-Plex-Token": plex_token},
        params={"includeHttps": 1, "includeRelay": 1},
    )
    resp.raise_for_status()
    servers = []
    for resource in resp.json():
        if "server" not in (resource.get("provides") or ""):
            continue
        conns = resource.get("connections", [])
        # Prefer non-relay HTTPS, then any available connection
        uri = None
        for conn in conns:
            if conn.get("protocol") == "https" and not conn.get("relay"):
                uri = conn.get("uri")
                break
        if not uri:
            for conn in conns:
                if conn.get("uri"):
                    uri = conn["uri"]
                    break
        if uri:
            servers.append({
                "name": resource.get("name", ""),
                "machine_id": resource.get("clientIdentifier", ""),
                "access_token": resource.get("accessToken", ""),
                "uri": uri,
            })
    return servers


async def get_library_sections(server_uri: str, server_token: str) -> list[dict]:
    """Returns movie/show library sections: [{key, title, type}]."""
    client = await _get_client()
    resp = await client.get(
        f"{server_uri}/library/sections",
        headers={**PLEX_HEADERS, "X-Plex-Token": server_token},
    )
    resp.raise_for_status()
    sections = []
    container = resp.json().get("MediaContainer", {})
    for section in container.get("Directory", []):
        stype = section.get("type", "")
        if stype in ("movie", "show"):
            sections.append({
                "key": section["key"],
                "title": section.get("title", ""),
                "type": stype,
            })
    return sections


# ---------------------------------------------------------------------------
# Library item fetching with TMDB ID extraction
# ---------------------------------------------------------------------------

def _extract_tmdb_id(item: dict) -> int | None:
    """Extract TMDB ID from a Plex library item's Guid array or legacy guid."""
    for guid_entry in item.get("Guid", []):
        m = _TMDB_GUID_RE.search(guid_entry.get("id", ""))
        if m:
            return int(m.group(1))
    # Legacy agent fallback
    m = _LEGACY_TMDB_RE.search(item.get("guid", ""))
    if m:
        return int(m.group(1))
    return None


async def get_library_items(
    server_uri: str,
    server_token: str,
    section_key: str,
    batch_size: int = 100,
) -> list[dict]:
    """Paginate through a library section, return [{tmdb_id, title, rating_key, media_type}]."""
    client = await _get_client()
    items: list[dict] = []
    start = 0
    while True:
        resp = await client.get(
            f"{server_uri}/library/sections/{section_key}/all",
            headers={**PLEX_HEADERS, "X-Plex-Token": server_token},
            params={
                "includeGuids": 1,
                "X-Plex-Container-Start": start,
                "X-Plex-Container-Size": batch_size,
            },
        )
        resp.raise_for_status()
        container = resp.json().get("MediaContainer", {})
        metadata_list = container.get("Metadata", [])
        if not metadata_list:
            break
        for meta in metadata_list:
            tmdb_id = _extract_tmdb_id(meta)
            if tmdb_id:
                plex_type = meta.get("type", "movie")
                items.append({
                    "tmdb_id": tmdb_id,
                    "title": meta.get("title", ""),
                    "rating_key": str(meta.get("ratingKey", "")),
                    "media_type": "tv" if plex_type == "show" else "movie",
                })
        total_size = container.get("totalSize", 0)
        start += batch_size
        if start >= total_size:
            break
        # Throttle to ~3 req/s to avoid overwhelming the PMS
        await asyncio.sleep(0.33)
    return items
