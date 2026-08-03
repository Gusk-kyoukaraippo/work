import json
import os
import re
import shutil
import shlex
import subprocess
import time
from datetime import datetime
from html import escape
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

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
NOTIFICATION_PREFIX = os.getenv("NOTIFICATION_PREFIX", "録音をギャル語に変換したよ。内容は次の通りです。")
LMSTUDIO_BASE_URL = os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234").rstrip("/")
LMSTUDIO_MODEL = os.getenv("LMSTUDIO_MODEL", "").strip()
LMSTUDIO_TIMEOUT_SECONDS = int(os.getenv("LMSTUDIO_TIMEOUT_SECONDS", "120"))
LMSTUDIO_TEMPERATURE = float(os.getenv("LMSTUDIO_TEMPERATURE", "0.7"))
LMSTUDIO_MAX_TOKENS = int(os.getenv("LMSTUDIO_MAX_TOKENS", "1200"))
CLASSIFICATION_TEMPERATURE = float(os.getenv("CLASSIFICATION_TEMPERATURE", "0"))
CLASSIFICATION_MAX_TOKENS = int(os.getenv("CLASSIFICATION_MAX_TOKENS", "200"))
RING_ONLY_TIMEOUT_SECONDS = int(os.getenv("RING_ONLY_TIMEOUT_SECONDS", "5"))
TIME_NOTIFICATION_ROUTE = "time_notification"
GYARU_CALL_ROUTE = "gyaru_call"
CLASSIFICATION_SYSTEM_PROMPT = os.getenv(
    "CLASSIFICATION_SYSTEM_PROMPT",
    "あなたは音声文字起こしのルーティング判定器です。本文が現在時刻、時刻確認、時間通知、時報、アラーム、タイマー、リマインダーなど、時間を知らせることだけを目的にしている場合は time_notification に分類してください。それ以外のメモ、依頼、会話、説明、質問、記録は gyaru_call に分類してください。出力はJSONだけにしてください。",
)
CLASSIFICATION_USER_PROMPT = os.getenv(
    "CLASSIFICATION_USER_PROMPT",
    '次の文字起こしを分類してください。JSON形式で {"route":"time_notification" または "gyaru_call","reason":"短い理由"} だけを返してください。\n\n{text}',
)
GYARU_SYSTEM_PROMPT = os.getenv(
    "GYARU_SYSTEM_PROMPT",
    "あなたは日本語の文章を自然なギャル語に変換する編集者です。意味、固有名詞、数字、日時、依頼内容は変えず、読み上げやすい短い文にしてください。出力は変換後の本文だけにしてください。",
)
GYARU_USER_PROMPT = os.getenv(
    "GYARU_USER_PROMPT",
    "次の文字起こしを、電話で読み上げても自然なギャル語に変換して。要点は落とさず、盛りすぎず、でもギャルっぽくして。\n\n{text}",
)
DRY_RUN = os.getenv("DRY_RUN", "").lower() in {"1", "true", "yes", "on"}
RECORDING_EXTENSIONS = {
    extension.strip().lower()
    for extension in os.getenv("RECORDING_EXTENSIONS", ".m4a,.mp3,.wav,.caf,.aac").split(",")
    if extension.strip()
}
WHISPER_CPP_INPUT_EXTENSIONS = {".flac", ".mp3", ".ogg", ".wav"}

client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
resolved_lmstudio_model: str | None = None


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


def is_inside_watch_dir(path: Path) -> bool:
    if WATCH_DIR is None:
        return False

    try:
        path.resolve().relative_to(WATCH_DIR.resolve())
    except (OSError, ValueError):
        return False

    return True


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )


def lmstudio_request_json(path: str, payload: dict | None = None) -> dict:
    url = f"{LMSTUDIO_BASE_URL}{path}"
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="GET" if payload is None else "POST",
    )

    try:
        with urlopen(request, timeout=LMSTUDIO_TIMEOUT_SECONDS) as response:
            response_body = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LM Studio HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"LM Studio request failed: {exc.reason}") from exc

    try:
        data = json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise RuntimeError("LM Studio returned invalid JSON") from exc

    if not isinstance(data, dict):
        raise RuntimeError("LM Studio returned unexpected JSON")

    return data


def list_lmstudio_models() -> list[str]:
    data = lmstudio_request_json("/v1/models")
    models = data.get("data")
    if not isinstance(models, list):
        raise RuntimeError("LM Studio /v1/models did not return a data list")

    ids = [model.get("id") for model in models if isinstance(model, dict)]
    return [model_id for model_id in ids if isinstance(model_id, str) and model_id]


def get_lmstudio_model() -> str:
    global resolved_lmstudio_model

    if resolved_lmstudio_model:
        return resolved_lmstudio_model

    models = list_lmstudio_models()
    if not models:
        raise RuntimeError("LM Studio has no loaded models")

    if LMSTUDIO_MODEL:
        if LMSTUDIO_MODEL not in models:
            available = ", ".join(models)
            raise RuntimeError(
                f"LMSTUDIO_MODEL is not loaded: {LMSTUDIO_MODEL}. Available: {available}"
            )
        resolved_lmstudio_model = LMSTUDIO_MODEL
        return resolved_lmstudio_model

    non_embedding_models = [model for model in models if "embedding" not in model.lower()]
    resolved_lmstudio_model = non_embedding_models[0] if non_embedding_models else models[0]
    return resolved_lmstudio_model


def get_chat_completion_content(
    messages: list[dict[str, str]],
    *,
    temperature: float,
    max_tokens: int,
    purpose: str,
) -> str:
    model = get_lmstudio_model()
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    print(f"[lmstudio] {purpose} with model={model}", flush=True)
    data = lmstudio_request_json("/v1/chat/completions", payload)

    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("LM Studio returned no choices")

    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        raise RuntimeError("LM Studio returned an invalid choice")

    message = first_choice.get("message")
    if not isinstance(message, dict):
        raise RuntimeError("LM Studio returned no message")

    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("LM Studio returned empty text")

    return content.strip()


def render_prompt(template: str, text: str) -> str:
    return template.replace("\\n", "\n").replace("{text}", text)


def parse_classification_json(content: str) -> dict:
    text = content.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        text = fenced.group(1).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise RuntimeError(f"LM Studio returned classification without JSON: {content}")

    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"LM Studio returned invalid classification JSON: {content}") from exc

    if not isinstance(data, dict):
        raise RuntimeError("LM Studio classification JSON was not an object")

    return data


def save_classification(audio_path: Path, classification: dict) -> Path:
    output_dir = WORK_DIR / "classifications"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{audio_path.stem}.json"
    output_path.write_text(
        json.dumps(classification, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return output_path


def classify_transcript(transcript: str, audio_path: Path) -> dict:
    content = get_chat_completion_content(
        [
            {
                "role": "system",
                "content": CLASSIFICATION_SYSTEM_PROMPT.replace("\\n", "\n"),
            },
            {
                "role": "user",
                "content": render_prompt(CLASSIFICATION_USER_PROMPT, transcript),
            },
        ],
        temperature=CLASSIFICATION_TEMPERATURE,
        max_tokens=CLASSIFICATION_MAX_TOKENS,
        purpose="classifying transcript",
    )
    classification = parse_classification_json(content)
    route = str(classification.get("route", "")).strip()
    if route not in {TIME_NOTIFICATION_ROUTE, GYARU_CALL_ROUTE}:
        raise RuntimeError(f"Unknown classification route: {route}")

    classification["route"] = route
    classification.setdefault("reason", "")
    classification["transcript"] = transcript
    output_path = save_classification(audio_path, classification)
    print(f"[route] {route} reason={classification.get('reason', '')}", flush=True)
    print(f"[route] saved classification: {output_path}", flush=True)
    return classification


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


def save_gyaru_text(audio_path: Path, text: str) -> Path:
    output_dir = WORK_DIR / "gyaru_texts"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{audio_path.stem}.txt"
    output_path.write_text(text.strip() + "\n", encoding="utf-8")
    return output_path


def transform_to_gyaru(transcript: str, audio_path: Path) -> str:
    gyaru_text = get_chat_completion_content(
        [
            {"role": "system", "content": GYARU_SYSTEM_PROMPT.replace("\\n", "\n")},
            {"role": "user", "content": render_prompt(GYARU_USER_PROMPT, transcript)},
        ],
        temperature=LMSTUDIO_TEMPERATURE,
        max_tokens=LMSTUDIO_MAX_TOKENS,
        purpose="converting transcript",
    )
    output_path = save_gyaru_text(audio_path, gyaru_text)
    print(f"[lmstudio] saved gyaru text: {output_path}", flush=True)
    return gyaru_text


def truncate_for_call(text: str) -> str:
    normalized = " ".join(text.split())
    if len(normalized) <= TRANSCRIPT_MAX_CHARS:
        return normalized
    return f"{normalized[:TRANSCRIPT_MAX_CHARS]}。文字数上限のため、以降は省略しました。"


def notify_by_twilio(recording_path: Path, gyaru_text: str) -> None:
    message = f"{NOTIFICATION_PREFIX} {truncate_for_call(gyaru_text)}"
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="ja-JP">{escape(message)}</Say>
  <Pause length="1"/>
  <Hangup/>
</Response>
"""

    print(f"[notify] Twilio gyaru call for: {recording_path}", flush=True)

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


def notify_by_twilio_ring_only(recording_path: Path, classification: dict) -> None:
    twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>
"""

    print(f"[notify] Twilio ring-only call for: {recording_path}", flush=True)

    if DRY_RUN:
        print("[notify] DRY_RUN is enabled; skipped Twilio ring-only call", flush=True)
        print(f"[notify] classification: {classification}", flush=True)
        return

    try:
        call = client.calls.create(
            to=MY_PHONE_NUMBER,
            from_=TWILIO_FROM_NUMBER,
            twiml=twiml,
            timeout=RING_ONLY_TIMEOUT_SECONDS,
        )
    except TwilioRestException as exc:
        raise RuntimeError(f"Twilio error {exc.code}: {exc.msg}") from exc

    print(f"[notify] ring_only_call_sid={call.sid}", flush=True)


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
    classification = classify_transcript(transcript, copied_path)
    if classification["route"] == TIME_NOTIFICATION_ROUTE:
        notify_by_twilio_ring_only(copied_path, classification)
        return

    gyaru_text = transform_to_gyaru(transcript, copied_path)
    print(f"[gyaru] {gyaru_text}", flush=True)
    notify_by_twilio(copied_path, gyaru_text)


class JPRRecordingHandler(FileSystemEventHandler):
    def __init__(self) -> None:
        self.seen = load_seen()
        self.last_started_at = 0.0

    def on_created(self, event) -> None:
        self.handle_path(Path(event.src_path), is_directory=event.is_directory)

    def on_moved(self, event) -> None:
        destination = Path(event.dest_path)
        if not is_inside_watch_dir(destination):
            print(f"[skip] moved outside watch dir: {destination}", flush=True)
            return

        self.handle_path(destination, is_directory=event.is_directory)

    def on_deleted(self, event) -> None:
        print(f"[skip] deleted: {event.src_path}", flush=True)

    def handle_path(self, candidate_path: Path, is_directory: bool) -> None:
        if not is_inside_watch_dir(candidate_path):
            print(f"[skip] outside watch dir: {candidate_path}", flush=True)
            return

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
    print(f"[start] LM Studio model: {get_lmstudio_model()}", flush=True)

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
