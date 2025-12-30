import argparse
import datetime as dt
import os
import queue
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

import yaml
from notion_client import Client as NotionClient
from openai import OpenAI
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer


@dataclass
class AppConfig:
    watch_root: Path
    recursive: bool
    extensions: set[str]
    stability_wait_seconds: int
    stability_checks: int

    whisper_cpp_bin: Path
    whisper_cpp_model: Path
    whisper_cpp_language: str
    whisper_cpp_threads: int
    whisper_cpp_no_timestamps: bool

    postprocess_enabled: bool
    postprocess_model: str
    postprocess_api_base: str
    postprocess_api_key: str
    postprocess_system_prompt: str

    notion_enabled: bool
    notion_database_id: str
    notion_title_property: str
    notion_recorded_at_property: str
    notion_source_path_property: Optional[str]

    state_db_path: Path


def load_config(path: Path) -> AppConfig:
    with path.open("r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    watch = raw.get("watch", {})
    transcription = raw.get("transcription", {})
    whisper_cpp = transcription.get("whisper_cpp", transcription)
    postprocess = raw.get("postprocess", {})
    notion = raw.get("notion", {})
    properties = notion.get("properties", {})
    state = raw.get("state", {})

    return AppConfig(
        watch_root=Path(watch.get("root_dir", "")),
        recursive=bool(watch.get("recursive", True)),
        extensions=set(watch.get("extensions", [".m4a"])),
        stability_wait_seconds=int(watch.get("stability_wait_seconds", 2)),
        stability_checks=int(watch.get("stability_checks", 3)),
        whisper_cpp_bin=Path(whisper_cpp.get("bin_path", "whisper.cpp/main")),
        whisper_cpp_model=Path(whisper_cpp.get("model_path", "models/ggml-large-v3-turbo-q8_0.bin")),
        whisper_cpp_language=str(whisper_cpp.get("language", "ja")),
        whisper_cpp_threads=int(whisper_cpp.get("threads", 4)),
        whisper_cpp_no_timestamps=bool(whisper_cpp.get("no_timestamps", True)),
        postprocess_enabled=bool(postprocess.get("enabled", True)),
        postprocess_model=str(postprocess.get("model", "openai/gpt-oss-20b")),
        postprocess_api_base=str(postprocess.get("api_base", "http://localhost:1234/v1")),
        postprocess_api_key=str(postprocess.get("api_key", "lm-studio")),
        postprocess_system_prompt=str(
            postprocess.get(
                "system_prompt",
                "Fix obvious typos while keeping meaning. Return Japanese only.",
            )
        ),
        notion_enabled=bool(notion.get("enabled", True)),
        notion_database_id=str(notion.get("database_id", "")),
        notion_title_property=str(properties.get("title", "Name")),
        notion_recorded_at_property=str(properties.get("recorded_at", "Recorded At")),
        notion_source_path_property=properties.get("source_path"),
        state_db_path=Path(state.get("db_path", ".data/processed.sqlite")),
    )


class StateStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path)
        self._init_db()

    def _init_db(self) -> None:
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS processed_files (
                path TEXT PRIMARY KEY,
                mtime REAL NOT NULL
            )
            """
        )
        self.conn.commit()

    def is_processed(self, path: Path, mtime: float) -> bool:
        row = self.conn.execute(
            "SELECT mtime FROM processed_files WHERE path = ?", (str(path),)
        ).fetchone()
        if not row:
            return False
        return float(row[0]) == mtime

    def mark_processed(self, path: Path, mtime: float) -> None:
        self.conn.execute(
            "INSERT OR REPLACE INTO processed_files (path, mtime) VALUES (?, ?)",
            (str(path), mtime),
        )
        self.conn.commit()


class Transcriber:
    def __init__(self, cfg: AppConfig) -> None:
        self.cfg = cfg
        self.ffmpeg_timeout_seconds = int(os.getenv("FFMPEG_TIMEOUT_SECONDS", "60"))
        self.whisper_timeout_seconds = int(os.getenv("WHISPER_TIMEOUT_SECONDS", "600"))

    def _temp_base_dir(self) -> Path:
        tmp_root = Path(os.getenv("TMPDIR", "/tmp"))
        tmp_root.mkdir(parents=True, exist_ok=True)
        return tmp_root

    def _prepare_input(self, path: Path, tmpdir: Path) -> Path:
        if path.suffix.lower() in {".wav", ".mp3", ".flac", ".ogg"}:
            return path
        if path.suffix.lower() != ".m4a":
            raise RuntimeError(f"unsupported input format: {path.suffix}")
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("ffmpeg is required to convert m4a to wav")
        wav_path = tmpdir / "input.wav"
        try:
            result = subprocess.run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(path),
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    "-c:a",
                    "pcm_s16le",
                    str(wav_path),
                ],
                capture_output=True,
                text=True,
                timeout=self.ffmpeg_timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("ffmpeg timed out") from exc
        if result.returncode != 0:
            raise RuntimeError(
                "ffmpeg failed: " f"{result.stderr.strip() or result.stdout.strip()}"
            )
        return wav_path

    def _build_command(self, input_path: Path, output_prefix: Path) -> list[str]:
        cmd = [
            str(self.cfg.whisper_cpp_bin),
            "-m",
            str(self.cfg.whisper_cpp_model),
            "-f",
            str(input_path),
            "-l",
            self.cfg.whisper_cpp_language,
            "-t",
            str(self.cfg.whisper_cpp_threads),
            "-otxt",
            "-of",
            str(output_prefix),
        ]
        if self.cfg.whisper_cpp_no_timestamps:
            cmd.append("-nt")
        return cmd

    def transcribe(self, path: Path) -> str:
        if not self.cfg.whisper_cpp_bin.exists():
            raise FileNotFoundError(f"whisper.cpp binary not found: {self.cfg.whisper_cpp_bin}")
        if not self.cfg.whisper_cpp_model.exists():
            raise FileNotFoundError(f"whisper.cpp model not found: {self.cfg.whisper_cpp_model}")

        with tempfile.TemporaryDirectory(dir=self._temp_base_dir()) as tmpdir:
            tmpdir_path = Path(tmpdir)
            input_path = self._prepare_input(path, tmpdir_path)
            output_prefix = tmpdir_path / "transcript"
            cmd = self._build_command(input_path, output_prefix)
            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=self.whisper_timeout_seconds,
                )
            except subprocess.TimeoutExpired as exc:
                raise RuntimeError("whisper.cpp timed out") from exc
            if result.returncode != 0:
                raise RuntimeError(
                    "whisper.cpp failed: "
                    f"{result.stderr.strip() or result.stdout.strip()}"
                )
            output_path = output_prefix.with_suffix(".txt")
            if not output_path.exists():
                raise RuntimeError("whisper.cpp output was not generated")
            return output_path.read_text(encoding="utf-8").strip()


class LmStudioCorrector:
    def __init__(self, cfg: AppConfig) -> None:
        self.cfg = cfg
        self.client = OpenAI(api_key=cfg.postprocess_api_key, base_url=cfg.postprocess_api_base)

    def correct(self, text: str) -> str:
        if not text.strip():
            return text
        response = self.client.chat.completions.create(
            model=self.cfg.postprocess_model,
            messages=[
                {"role": "system", "content": self.cfg.postprocess_system_prompt},
                {"role": "user", "content": text},
            ],
            temperature=0.1,
        )
        return response.choices[0].message.content.strip()


class NotionWriter:
    def __init__(self, cfg: AppConfig, token: str) -> None:
        self.cfg = cfg
        self.client = NotionClient(auth=token)

    def _chunk_text(self, text: str, max_len: int = 2000) -> Iterable[str]:
        buffer = []
        size = 0
        for line in text.splitlines():
            if size + len(line) + 1 > max_len and buffer:
                yield "\n".join(buffer)
                buffer = [line]
                size = len(line)
                continue
            buffer.append(line)
            size += len(line) + 1
        if buffer:
            yield "\n".join(buffer)

    def create_page(self, title: str, recorded_at: dt.datetime, text: str, source_path: Path) -> None:
        properties = {
            self.cfg.notion_title_property: {"title": [{"text": {"content": title}}]},
            self.cfg.notion_recorded_at_property: {
                "date": {"start": recorded_at.isoformat()}
            },
        }
        if self.cfg.notion_source_path_property:
            properties[self.cfg.notion_source_path_property] = {
                "rich_text": [{"text": {"content": str(source_path)}}]
            }

        page = self.client.pages.create(
            parent={"database_id": self.cfg.notion_database_id},
            properties=properties,
        )
        page_id = page["id"]

        blocks = []
        for chunk in self._chunk_text(text):
            blocks.append(
                {
                    "object": "block",
                    "type": "paragraph",
                    "paragraph": {"rich_text": [{"type": "text", "text": {"content": chunk}}]},
                }
            )
        if blocks:
            self.client.blocks.children.append(page_id, children=blocks)


class AudioHandler(FileSystemEventHandler):
    def __init__(
        self,
        cfg: AppConfig,
        task_queue: queue.Queue[Path],
        debouncer: "Debouncer",
        in_flight: "InFlightTracker",
    ) -> None:
        super().__init__()
        self.cfg = cfg
        self.task_queue = task_queue
        self.debouncer = debouncer
        self.in_flight = in_flight

    def on_created(self, event) -> None:
        self._enqueue_event(event)

    def on_modified(self, event) -> None:
        self._enqueue_event(event)

    def on_moved(self, event) -> None:
        self._enqueue_event(event)

    def _enqueue_event(self, event) -> None:
        if event.is_directory:
            return
        event_path = getattr(event, "dest_path", None) or event.src_path
        path = Path(event_path)
        if path.suffix.lower() not in self.cfg.extensions:
            return
        if path.suffix.lower() in {".tmp", ".part", ".download", ".crdownload"}:
            return
        if not self.debouncer.should_accept(path):
            return
        if not self.in_flight.try_add(path):
            return
        try:
            self.task_queue.put_nowait(path)
        except queue.Full:
            print(f"[warn] queue full, drop: {path}")
            self.in_flight.done(path)


class Debouncer:
    def __init__(self, interval_seconds: float) -> None:
        self.interval_seconds = interval_seconds
        self._last_seen: dict[Path, float] = {}
        self._lock = threading.Lock()

    def should_accept(self, path: Path) -> bool:
        now = time.time()
        with self._lock:
            last = self._last_seen.get(path)
            if last is not None and now - last < self.interval_seconds:
                return False
            self._last_seen[path] = now
            if len(self._last_seen) > 10000:
                cutoff = now - self.interval_seconds * 2
                self._last_seen = {p: t for p, t in self._last_seen.items() if t >= cutoff}
            return True


class InFlightTracker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._paths: set[Path] = set()

    def try_add(self, path: Path) -> bool:
        with self._lock:
            if path in self._paths:
                return False
            self._paths.add(path)
            return True

    def done(self, path: Path) -> None:
        with self._lock:
            self._paths.discard(path)


class Processor:
    def __init__(
        self,
        cfg: AppConfig,
        state: StateStore,
        transcriber: Transcriber,
        corrector: Optional[LmStudioCorrector],
        notion_writer: Optional[NotionWriter],
        quarantine_dir: Path,
        retry_max: int,
        backoff_base: float,
    ) -> None:
        self.cfg = cfg
        self.state = state
        self.transcriber = transcriber
        self.corrector = corrector
        self.notion_writer = notion_writer
        self.quarantine_dir = quarantine_dir
        self.retry_max = retry_max
        self.backoff_base = backoff_base

    def process(self, path: Path) -> None:
        if not path.exists():
            print(f"[skip] file missing: {path}")
            return
        if path.suffix.lower() not in self.cfg.extensions:
            print(f"[skip] unsupported extension: {path.suffix}")
            return
        if path.suffix.lower() in {".tmp", ".part", ".download", ".crdownload"}:
            print(f"[skip] temporary extension: {path}")
            return
        if path.stat().st_size == 0:
            print(f"[skip] zero-byte file: {path}")
            return
        if not self._wait_for_stable(path):
            print(f"[skip] file not stable: {path}")
            return

        mtime = path.stat().st_mtime
        if self.state.is_processed(path, mtime):
            print(f"[skip] already processed: {path}")
            return

        attempt = 0
        while attempt <= self.retry_max:
            attempt += 1
            try:
                print(f"[start] transcribing: {path}")
                transcript = self.transcriber.transcribe(path)
            except Exception as exc:
                if attempt > self.retry_max:
                    print(f"[error] failed after retries: {path}: {exc}")
                    self._quarantine(path)
                    return
                sleep_seconds = self.backoff_base * (2 ** (attempt - 1))
                print(f"[retry] {attempt}/{self.retry_max} in {sleep_seconds:.1f}s: {exc}")
                time.sleep(sleep_seconds)
                continue
            else:
                self.state.mark_processed(path, mtime)
                break

        try:
            if self.corrector and self.cfg.postprocess_enabled:
                try:
                    transcript = self.corrector.correct(transcript)
                except Exception as exc:
                    print(f"[warn] postprocess failed, skip: {path}: {exc}")
        except Exception as exc:
            print(f"[error] postprocess failed (no quarantine): {path}: {exc}")
            return

        try:
            if self.notion_writer and self.cfg.notion_enabled:
                recorded_at = dt.datetime.fromtimestamp(mtime)
                title = path.stem
                self.notion_writer.create_page(title, recorded_at, transcript, path)
                try:
                    path.unlink()
                    print(f"[cleanup] deleted source: {path}")
                except OSError as exc:
                    print(f"[warn] failed to delete source: {path}: {exc}")
        except Exception as exc:
            print(f"[error] notion failed (no quarantine): {path}: {exc}")
            return

        print(f"[done] processed: {path}")
        return

    def _wait_for_stable(self, path: Path) -> bool:
        last_size = -1
        for _ in range(self.cfg.stability_checks):
            if not path.exists():
                return False
            size = path.stat().st_size
            if size == last_size and size > 0:
                return True
            last_size = size
            time.sleep(self.cfg.stability_wait_seconds)
        return False

    def _quarantine(self, path: Path) -> None:
        try:
            self.quarantine_dir.mkdir(parents=True, exist_ok=True)
            target = self.quarantine_dir / path.name
            if target.exists():
                target = self.quarantine_dir / f"{path.stem}.{int(time.time())}{path.suffix}"
            shutil.copy2(str(path), str(target))
            print(f"[warn] quarantined copy: {target}")
        except Exception as exc:
            print(f"[error] failed to quarantine {path}: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Watch iCloud JPR recordings and sync to Notion")
    parser.add_argument("--config", default="config.yaml", help="Path to config file")
    args = parser.parse_args()

    cfg = load_config(Path(args.config))

    if not cfg.watch_root.exists():
        print(f"watch root does not exist: {cfg.watch_root}")
        return 1

    task_queue: queue.Queue[Path] = queue.Queue(maxsize=1000)
    debouncer = Debouncer(interval_seconds=1.0)
    in_flight = InFlightTracker()
    handler = AudioHandler(cfg, task_queue, debouncer, in_flight)

    observer = Observer()
    observer.schedule(handler, str(cfg.watch_root), recursive=cfg.recursive)
    observer.start()

    stop_event = threading.Event()

    def worker() -> None:
        state = StateStore(cfg.state_db_path)
        transcriber = Transcriber(cfg)
        corrector = LmStudioCorrector(cfg) if cfg.postprocess_enabled else None

        notion_token = os.getenv("NOTION_TOKEN")
        if cfg.notion_enabled and not notion_token:
            print("NOTION_TOKEN is not set; Notion sync will be disabled.")
            notion_token = None
        notion_writer = NotionWriter(cfg, notion_token) if cfg.notion_enabled and notion_token else None

        quarantine_dir = cfg.state_db_path.parent / "quarantine"
        processor = Processor(
            cfg=cfg,
            state=state,
            transcriber=transcriber,
            corrector=corrector,
            notion_writer=notion_writer,
            quarantine_dir=quarantine_dir,
            retry_max=3,
            backoff_base=1.0,
        )
        while not stop_event.is_set():
            try:
                path = task_queue.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                processor.process(path)
            finally:
                in_flight.done(path)
                task_queue.task_done()

    worker_thread = threading.Thread(target=worker, name="processor", daemon=True)
    worker_thread.start()

    print(f"Watching: {cfg.watch_root} (recursive={cfg.recursive})")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Stopping...")
    finally:
        stop_event.set()
        observer.stop()
        observer.join()
        worker_thread.join(timeout=5)
    return 0


if __name__ == "__main__":
    sys.exit(main())
