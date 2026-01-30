import json
from pathlib import Path

CONFIG_PATH = Path(__file__).parent.parent / "user_config.json"


def load_config() -> dict:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text())
    return {"provider_ids": []}


def save_config(data: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(data, indent=2))
