import json
import os
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

from dotenv import dotenv_values
from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def load_environment() -> None:
    existing_keys = set(os.environ)
    values = {
        **dotenv_values(PROJECT_ROOT / ".env"),
        **dotenv_values(Path(__file__).with_name(".env")),
    }

    for key, value in values.items():
        if value is not None and key not in existing_keys:
            os.environ[key] = value


load_environment()

STATE_FILE = Path(os.getenv("STATE_FILE", "seen_folders.json")).expanduser()
WATCH_DIR_ENV = os.getenv("WATCH_DIR", "").strip()
WATCH_DIR = Path(WATCH_DIR_ENV).expanduser() if WATCH_DIR_ENV else None
DEBOUNCE_SECONDS = int(os.getenv("DEBOUNCE_SECONDS", "10"))
ICLOUD_SETTLE_SECONDS = int(os.getenv("ICLOUD_SETTLE_SECONDS", "3"))
DRY_RUN = os.getenv("DRY_RUN", "").lower() in {"1", "true", "yes", "on"}
RECORDING_EXTENSIONS = {
    extension.strip().lower()
    for extension in os.getenv("RECORDING_EXTENSIONS", ".m4a,.mp3,.wav,.caf").split(",")
    if extension.strip()
}


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


TWILIO_ACCOUNT_SID = required_env("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = required_env("TWILIO_AUTH_TOKEN")
TWILIO_FROM_NUMBER = required_env("TWILIO_FROM_NUMBER")
MY_PHONE_NUMBER = required_env("MY_PHONE_NUMBER")
def normalize_url(value: str) -> str:
    parts = urlsplit(value)
    path = quote(parts.path, safe="/%")
    query = quote(parts.query, safe="=&%")
    fragment = quote(parts.fragment, safe="%")
    return urlunsplit((parts.scheme, parts.netloc, path, query, fragment))


TWIML_URL = normalize_url(required_env("TWIML_URL"))

client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)


def load_seen() -> set[str]:
    if not STATE_FILE.exists():
        return set()

    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()

    if not isinstance(data, list):
        return set()

    return {str(item) for item in data}


def save_seen(seen: set[str]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(
        json.dumps(sorted(seen), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def path_key(path: Path) -> str:
    return str(path.resolve())


def should_ignore(path: Path) -> bool:
    name = path.name

    if name.startswith("."):
        return True
    if ".icloud" in name:
        return True
    if name.lower() in {"tmp", "temp", "__macosx"}:
        return True

    return False


def is_recording_file(path: Path) -> bool:
    return path.suffix.lower() in RECORDING_EXTENSIONS and not should_ignore(path)


def notify_by_twilio(recording_path: Path) -> None:
    print(f"[notify] Twilio call for: {recording_path}", flush=True)

    if DRY_RUN:
        print("[notify] DRY_RUN is enabled; skipped Twilio call", flush=True)
        return

    try:
        call = client.calls.create(
            to=MY_PHONE_NUMBER,
            from_=TWILIO_FROM_NUMBER,
            url=TWIML_URL,
        )
    except TwilioRestException as exc:
        raise RuntimeError(f"Twilio error {exc.code}: {exc.msg}") from exc

    print(f"[notify] call_sid={call.sid}", flush=True)


class JPRFolderHandler(FileSystemEventHandler):
    def __init__(self) -> None:
        self.seen = load_seen()
        self.last_notified_at = 0.0

    def on_created(self, event) -> None:
        self.handle_path(Path(event.src_path), is_directory=event.is_directory)

    def on_moved(self, event) -> None:
        self.handle_path(Path(event.dest_path), is_directory=event.is_directory)

    def handle_path(self, candidate_path: Path, is_directory: bool) -> None:
        if is_directory:
            if should_ignore(candidate_path):
                return
        elif not is_recording_file(candidate_path):
            return

        key = path_key(candidate_path)
        if key in self.seen:
            return

        now = time.time()
        if now - self.last_notified_at < DEBOUNCE_SECONDS:
            print(f"[skip] debounce: {candidate_path}", flush=True)
            return

        time.sleep(ICLOUD_SETTLE_SECONDS)

        if not candidate_path.exists():
            print(f"[skip] disappeared: {candidate_path}", flush=True)
            return

        self.seen.add(key)
        save_seen(self.seen)
        self.last_notified_at = time.time()

        item_type = "folder" if is_directory else "recording"
        print(f"[detected] {item_type} {datetime.now().isoformat(timespec='seconds')} {candidate_path}", flush=True)

        try:
            notify_by_twilio(candidate_path)
        except Exception as exc:
            print(f"[error] Twilio failed: {exc}", flush=True)


def initial_scan_mark_as_seen() -> None:
    if WATCH_DIR is None:
        raise RuntimeError("WATCH_DIR is empty. Set WATCH_DIR in .env.")

    seen = load_seen()

    for path in WATCH_DIR.rglob("*"):
        if path.is_dir() and not should_ignore(path):
            seen.add(path_key(path))
        elif path.is_file() and is_recording_file(path):
            seen.add(path_key(path))

    save_seen(seen)
    print(f"[init] marked existing folders as seen: {len(seen)}", flush=True)


def main() -> None:
    if WATCH_DIR is None:
        raise RuntimeError("WATCH_DIR is empty. Set WATCH_DIR in .env.")
    if not WATCH_DIR.exists():
        raise RuntimeError(f"WATCH_DIR does not exist: {WATCH_DIR}")
    if not WATCH_DIR.is_dir():
        raise RuntimeError(f"WATCH_DIR is not a directory: {WATCH_DIR}")

    print(f"[start] watching: {WATCH_DIR}", flush=True)
    print(f"[start] state file: {STATE_FILE}", flush=True)

    initial_scan_mark_as_seen()

    event_handler = JPRFolderHandler()
    observer = Observer()
    observer.schedule(event_handler, str(WATCH_DIR), recursive=True)
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("[stop] stopping observer", flush=True)
        observer.stop()

    observer.join()


if __name__ == "__main__":
    main()
