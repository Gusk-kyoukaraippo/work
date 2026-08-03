import json
import os
import shutil
import shlex
import subprocess
import time
from datetime import datetime
from html import escape
from pathlib import Path

from dotenv import dotenv_values
from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_DIR = Path(__file__).resolve().parent


def load_environment() -> None:
    existing_keys = set(os.environ)
    values = {
        **dotenv_values(PROJECT_ROOT / ".env"),
        **dotenv_values(SCRIPT_DIR / ".env"),
    }

    for key, value in values.items():
        if value is not None and key not in existing_keys:
            os.environ[key] = value


load_environment()


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


TWILIO_ACCOUNT_SID = required_env("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = required_env("TWILIO_AUTH_TOKEN")
TWILIO_FROM_NUMBER = required_env("TWILIO_FROM_NUMBER")
MY_PHONE_NUMBER = required_env("MY_PHONE_NUMBER")

WATCH_DIR_ENV = os.getenv("WATCH_DIR", "").strip()
WATCH_DIR = Path(WATCH_DIR_ENV).expanduser() if WATCH_DIR_ENV else None
STATE_FILE = Path(os.getenv("STATE_FILE", SCRIPT_DIR / "seen_recordings.json")).expanduser()
WORK_DIR = Path(os.getenv("WORK_DIR", SCRIPT_DIR / "recording_copies")).expanduser()
FFPROBE_BIN = os.getenv("FFPROBE_BIN", "ffprobe")
FFMPEG_BIN = os.getenv("FFMPEG_BIN", "ffmpeg")
WHISPER_BACKEND = os.getenv("WHISPER_BACKEND", "whisper_cpp").strip().lower()
WHISPER_COMMAND = os.getenv("WHISPER_COMMAND", "").strip()
WHISPER_CPP_BIN = os.getenv("WHISPER_CPP_BIN", "whisper-cli").strip()
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3").strip()
WHISPER_MODEL_PATH = os.getenv("WHISPER_MODEL_PATH", "").strip()
WHISPER_LANGUAGE = os.getenv("WHISPER_LANGUAGE", "ja").strip()
WHISPER_EXTRA_ARGS = os.getenv("WHISPER_EXTRA_ARGS", "").strip()
ICLOUD_SETTLE_SECONDS = int(os.getenv("ICLOUD_SETTLE_SECONDS", "3"))
DEBOUNCE_SECONDS = int(os.getenv("DEBOUNCE_SECONDS", "10"))
TRANSCRIPT_MAX_CHARS = int(os.getenv("TRANSCRIPT_MAX_CHARS", "1200"))
NOTIFICATION_PREFIX = os.getenv("NOTIFICATION_PREFIX", "録音の文字起こしが完了しました。内容は次の通りです。")
DRY_RUN = os.getenv("DRY_RUN", "").lower() in {"1", "true", "yes", "on"}
RECORDING_EXTENSIONS = {
    extension.strip().lower()
    for extension in os.getenv("RECORDING_EXTENSIONS", ".m4a,.mp3,.wav,.caf,.aac").split(",")
    if extension.strip()
}
WHISPER_CPP_INPUT_EXTENSIONS = {".flac", ".mp3", ".ogg", ".wav"}

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


def path_key(path: Path) -> str:
    stat = path.stat()
    return f"{path.resolve()}::{stat.st_size}::{stat.st_mtime_ns}"


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )


def probe_audio(path: Path) -> dict:
    result = run_command(
        [
            FFPROBE_BIN,
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ]
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffprobe could not read the file")

    try:
        info = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("ffprobe returned invalid JSON") from exc

    duration_raw = str(info.get("format", {}).get("duration", "")).strip()
    if not duration_raw:
        raise RuntimeError("ffprobe did not return duration")

    try:
        duration = float(duration_raw)
    except ValueError as exc:
        raise RuntimeError(f"ffprobe returned invalid duration: {duration_raw}") from exc

    if duration <= 0:
        raise RuntimeError(f"ffprobe returned non-positive duration: {duration}")

    audio_streams = [
        stream for stream in info.get("streams", []) if stream.get("codec_type") == "audio"
    ]
    if not audio_streams:
        raise RuntimeError("ffprobe did not find an audio stream")

    return {
        "duration": duration,
        "audio_streams": len(audio_streams),
        "codec": audio_streams[0].get("codec_name", "unknown"),
    }


def copy_for_transcription(source: Path) -> Path:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    destination = WORK_DIR / f"{source.stem}-{timestamp}{source.suffix.lower()}"
    shutil.copy2(source, destination)
    return destination


def prepare_audio_for_whisper(audio_path: Path) -> Path:
    if WHISPER_BACKEND != "whisper_cpp" and WHISPER_COMMAND:
        return audio_path

    if audio_path.suffix.lower() in WHISPER_CPP_INPUT_EXTENSIONS:
        return audio_path

    converted_dir = WORK_DIR / "converted"
    converted_dir.mkdir(parents=True, exist_ok=True)
    converted_path = converted_dir / f"{audio_path.stem}.wav"
    command = [
        FFMPEG_BIN,
        "-y",
        "-v",
        "error",
        "-i",
        str(audio_path),
        "-ar",
        "16000",
        "-ac",
        "1",
        str(converted_path),
    ]

    print(f"[convert] running: {shlex.join(command)}", flush=True)
    result = run_command(command)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"ffmpeg conversion failed: {detail}")

    print(f"[convert] {audio_path} -> {converted_path}", flush=True)
    return converted_path


def command_exists(command: str) -> bool:
    return Path(command).expanduser().exists() if "/" in command else shutil.which(command) is not None


def format_command_template(template: str, audio_path: Path, output_dir: Path, output_base: Path) -> list[str]:
    values = {
        "audio": str(audio_path),
        "output_dir": str(output_dir),
        "output_base": str(output_base),
        "model": WHISPER_MODEL,
        "model_path": WHISPER_MODEL_PATH,
        "language": WHISPER_LANGUAGE,
    }
    return shlex.split(template.format(**values))


def build_whisper_command(audio_path: Path, output_dir: Path, output_base: Path) -> list[str]:
    extra_args = shlex.split(WHISPER_EXTRA_ARGS)

    if WHISPER_COMMAND:
        return format_command_template(WHISPER_COMMAND, audio_path, output_dir, output_base) + extra_args

    if WHISPER_BACKEND in {"auto", "whisper_cpp"} and command_exists(WHISPER_CPP_BIN):
        if not WHISPER_MODEL_PATH:
            raise RuntimeError("WHISPER_MODEL_PATH is required when using whisper.cpp")
        return [
            WHISPER_CPP_BIN,
            "-m",
            WHISPER_MODEL_PATH,
            "-f",
            str(audio_path),
            "-l",
            WHISPER_LANGUAGE,
            "-otxt",
            "-of",
            str(output_base),
            *extra_args,
        ]

    if WHISPER_BACKEND in {"auto", "openai_whisper"} and command_exists("whisper"):
        return [
            "whisper",
            str(audio_path),
            "--model",
            WHISPER_MODEL,
            "--language",
            WHISPER_LANGUAGE,
            "--output_format",
            "txt",
            "--output_dir",
            str(output_dir),
            *extra_args,
        ]

    raise RuntimeError(
        "Whisper command was not found. Install whisper-cli or whisper, or set WHISPER_COMMAND."
    )


def read_transcript(audio_path: Path, output_dir: Path, output_base: Path, stdout: str) -> str:
    candidates = [
        output_base.with_suffix(".txt"),
        output_dir / f"{audio_path.stem}.txt",
    ]

    for candidate in candidates:
        if candidate.exists():
            text = candidate.read_text(encoding="utf-8").strip()
            if text:
                return text

    text = stdout.strip()
    if text:
        return text

    raise RuntimeError("Whisper finished but no transcript text was found")


def transcribe(audio_path: Path) -> str:
    whisper_audio_path = prepare_audio_for_whisper(audio_path)
    output_dir = WORK_DIR / "transcripts"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_base = output_dir / audio_path.stem
    command = build_whisper_command(whisper_audio_path, output_dir, output_base)

    print(f"[whisper] running: {shlex.join(command)}", flush=True)
    result = run_command(command)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"Whisper failed: {detail}")

    return read_transcript(audio_path, output_dir, output_base, result.stdout)


def truncate_for_call(text: str) -> str:
    normalized = " ".join(text.split())
    if len(normalized) <= TRANSCRIPT_MAX_CHARS:
        return normalized
    return f"{normalized[:TRANSCRIPT_MAX_CHARS]}。文字数上限のため、以降は省略しました。"


def notify_by_twilio(recording_path: Path, transcript: str) -> None:
    message = f"{NOTIFICATION_PREFIX} {truncate_for_call(transcript)}"
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="ja-JP">{escape(message)}</Say>
  <Pause length="1"/>
  <Hangup/>
</Response>
"""

    print(f"[notify] Twilio transcript call for: {recording_path}", flush=True)

    if DRY_RUN:
        print("[notify] DRY_RUN is enabled; skipped Twilio call", flush=True)
        print(f"[notify] message: {message}", flush=True)
        return

    try:
        call = client.calls.create(
            to=MY_PHONE_NUMBER,
            from_=TWILIO_FROM_NUMBER,
            twiml=twiml,
        )
    except TwilioRestException as exc:
        raise RuntimeError(f"Twilio error {exc.code}: {exc.msg}") from exc

    print(f"[notify] call_sid={call.sid}", flush=True)


def process_recording(path: Path) -> None:
    time.sleep(ICLOUD_SETTLE_SECONDS)

    if not path.exists():
        print(f"[skip] disappeared: {path}", flush=True)
        return

    print(f"[probe] checking audio: {path}", flush=True)
    probe = probe_audio(path)
    print(
        f"[probe] ok duration={probe['duration']:.2f}s "
        f"streams={probe['audio_streams']} codec={probe['codec']}",
        flush=True,
    )

    copied_path = copy_for_transcription(path)
    print(f"[copy] {path} -> {copied_path}", flush=True)

    transcript = transcribe(copied_path)
    print(f"[transcript] {transcript}", flush=True)
    notify_by_twilio(copied_path, transcript)


class JPRRecordingHandler(FileSystemEventHandler):
    def __init__(self) -> None:
        self.seen = load_seen()
        self.last_started_at = 0.0

    def on_created(self, event) -> None:
        self.handle_path(Path(event.src_path), is_directory=event.is_directory)

    def on_moved(self, event) -> None:
        self.handle_path(Path(event.dest_path), is_directory=event.is_directory)

    def handle_path(self, candidate_path: Path, is_directory: bool) -> None:
        if is_directory:
            self.handle_directory(candidate_path)
            return

        if is_recording_file(candidate_path):
            self.handle_recording(candidate_path)

    def handle_directory(self, directory: Path) -> None:
        if should_ignore(directory) or not directory.exists():
            return

        for path in directory.rglob("*"):
            if path.is_file() and is_recording_file(path):
                self.handle_recording(path)

    def handle_recording(self, recording_path: Path) -> None:
        if not recording_path.exists():
            return

        try:
            key = path_key(recording_path)
        except OSError as exc:
            print(f"[skip] cannot stat: {recording_path} ({exc})", flush=True)
            return

        if key in self.seen:
            return

        now = time.time()
        if now - self.last_started_at < DEBOUNCE_SECONDS:
            print(f"[skip] debounce: {recording_path}", flush=True)
            return

        self.last_started_at = now
        print(
            f"[detected] recording {datetime.now().isoformat(timespec='seconds')} {recording_path}",
            flush=True,
        )

        try:
            process_recording(recording_path)
        except Exception as exc:
            print(f"[error] processing failed: {exc}", flush=True)
            return

        self.seen.add(key)
        save_seen(self.seen)


def initial_scan_mark_as_seen() -> None:
    if WATCH_DIR is None:
        raise RuntimeError("WATCH_DIR is empty. Set WATCH_DIR in .env.")

    seen = load_seen()

    for path in WATCH_DIR.rglob("*"):
        if path.is_file() and is_recording_file(path):
            try:
                seen.add(path_key(path))
            except OSError:
                continue

    save_seen(seen)
    print(f"[init] marked existing recordings as seen: {len(seen)}", flush=True)


def main() -> None:
    if WATCH_DIR is None:
        raise RuntimeError("WATCH_DIR is empty. Set WATCH_DIR in .env.")
    if not WATCH_DIR.exists():
        raise RuntimeError(f"WATCH_DIR does not exist: {WATCH_DIR}")
    if not WATCH_DIR.is_dir():
        raise RuntimeError(f"WATCH_DIR is not a directory: {WATCH_DIR}")

    print(f"[start] watching: {WATCH_DIR}", flush=True)
    print(f"[start] state file: {STATE_FILE}", flush=True)
    print(f"[start] work dir: {WORK_DIR}", flush=True)

    initial_scan_mark_as_seen()

    event_handler = JPRRecordingHandler()
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
