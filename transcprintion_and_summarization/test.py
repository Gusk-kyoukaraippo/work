import argparse
import logging
import queue
import sys
import threading
import time
from pathlib import Path

try:
    from openai import OpenAI
except ModuleNotFoundError as exc:
    raise SystemExit(
        "Missing dependency: openai. Run `pip install -r requirements.txt`."
    ) from exc

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from main import AppConfig, Transcriber, load_config

TEMP_EXTENSIONS = {".tmp", ".part", ".download", ".crdownload"}


class SummaryClient:
    def __init__(self, cfg: AppConfig) -> None:
        self.client = OpenAI(
            api_key=cfg.postprocess_api_key,
            base_url=cfg.postprocess_api_base,
        )

    def build_summary(self, transcript: str, prompt: str, model: str) -> str:
        response = self.client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": transcript},
            ],
            temperature=0.2,
        )
        return response.choices[0].message.content.strip()


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


class WatchHandler(FileSystemEventHandler):
    def __init__(
        self,
        cfg: AppConfig,
        task_queue: queue.Queue[Path],
        debouncer: Debouncer,
    ) -> None:
        super().__init__()
        self.cfg = cfg
        self.task_queue = task_queue
        self.debouncer = debouncer

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
        if path.suffix.lower() in TEMP_EXTENSIONS:
            return
        if not self.debouncer.should_accept(path):
            return
        try:
            self.task_queue.put_nowait(path)
        except queue.Full:
            logging.warning("queue full, drop: %s", path)


class Processor:
    def __init__(
        self,
        cfg: AppConfig,
        transcriber: Transcriber,
        summary_client: SummaryClient | None,
        summary_model: str | None,
        summary_prompt: str,
        retry_max: int,
        backoff_base: float,
    ) -> None:
        self.cfg = cfg
        self.transcriber = transcriber
        self.summary_client = summary_client
        self.summary_model = summary_model
        self.summary_prompt = summary_prompt
        self.retry_max = retry_max
        self.backoff_base = backoff_base

    def process(self, path: Path) -> None:
        if not path.exists():
            logging.warning("skip: file missing: %s", path)
            return
        if path.suffix.lower() not in self.cfg.extensions:
            logging.warning("skip: unsupported extension: %s", path.suffix)
            return
        if path.suffix.lower() in TEMP_EXTENSIONS:
            logging.warning("skip: temporary extension: %s", path)
            return
        if path.stat().st_size == 0:
            logging.warning("skip: zero-byte file: %s", path)
            return
        if not self._wait_for_stable(path):
            logging.warning("skip: file not stable: %s", path)
            return

        attempt = 0
        while attempt <= self.retry_max:
            attempt += 1
            try:
                logging.info("start: transcribing: %s", path)
                transcript = self.transcriber.transcribe(path)
                summary = None
                if self.summary_client and self.summary_model and self.cfg.postprocess_enabled:
                    try:
                        summary = self.summary_client.build_summary(
                            transcript,
                            self.summary_prompt,
                            self.summary_model,
                        )
                    except Exception as exc:
                        logging.warning("postprocess failed, skip: %s: %s", path, exc)
                logging.info("transcript:\n%s", transcript)
                if summary is not None:
                    logging.info("summary:\n%s", summary)
                else:
                    logging.info("summary: disabled")
                logging.info("done: processed: %s", path)
                return
            except Exception as exc:
                if attempt > self.retry_max:
                    logging.exception("error: failed after retries: %s", path)
                    return
                sleep_seconds = self.backoff_base * (2 ** (attempt - 1))
                logging.warning(
                    "retry %s/%s in %.1fs: %s",
                    attempt,
                    self.retry_max,
                    sleep_seconds,
                    exc,
                )
                time.sleep(sleep_seconds)

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


def main() -> int:
    parser = argparse.ArgumentParser(description="Watch for audio and summarize with LM Studio")
    parser.add_argument("input", nargs="?", default=None, help="Path to watch directory")
    parser.add_argument("--config", default="config.yaml", help="Path to config file")
    parser.add_argument(
        "--summary-model",
        default=None,
        help="Override summary model (default: postprocess.model in config)",
    )
    parser.add_argument(
        "--summary-prompt",
        default=(
            "Summarize the following Japanese transcript. "
            "Respond in Japanese with concise bullet points."
        ),
        help="System prompt for summarization",
    )
    parser.add_argument(
        "--log-file",
        default=".data/test.log",
        help="Path to log file",
    )
    parser.add_argument(
        "--retry-max",
        type=int,
        default=3,
        help="Maximum retry attempts for processing failures",
    )
    parser.add_argument(
        "--retry-backoff",
        type=float,
        default=1.0,
        help="Base seconds for exponential backoff between retries",
    )
    parser.add_argument(
        "--debounce-seconds",
        type=float,
        default=1.0,
        help="Debounce window for duplicate events",
    )
    parser.add_argument(
        "--queue-max",
        type=int,
        default=1000,
        help="Maximum queue size before dropping events",
    )
    args = parser.parse_args()

    cfg = load_config(Path(args.config))
    input_path = Path(args.input) if args.input else cfg.watch_root

    transcriber = Transcriber(cfg)
    summary_model = args.summary_model or (cfg.postprocess_model if cfg.postprocess_enabled else None)
    summary_client = SummaryClient(cfg) if summary_model and cfg.postprocess_enabled else None

    if not input_path.exists():
        print(f"input directory does not exist: {input_path}", file=sys.stderr)
        return 1
    if not input_path.is_dir():
        print(f"input is not a directory: {input_path}", file=sys.stderr)
        return 1

    log_path = Path(args.log_file)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handlers = [
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(log_path, encoding="utf-8"),
    ]
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=handlers,
    )

    task_queue: queue.Queue[Path] = queue.Queue(maxsize=args.queue_max)
    debouncer = Debouncer(args.debounce_seconds)
    handler = WatchHandler(cfg, task_queue, debouncer)
    observer = Observer()
    observer.schedule(handler, str(input_path), recursive=cfg.recursive)
    observer.start()
    logging.info("watching: %s (recursive=%s)", input_path, cfg.recursive)
    processor = Processor(
        cfg=cfg,
        transcriber=transcriber,
        summary_client=summary_client,
        summary_model=summary_model,
        summary_prompt=args.summary_prompt,
        retry_max=args.retry_max,
        backoff_base=args.retry_backoff,
    )
    stop_event = threading.Event()

    def worker() -> None:
        while not stop_event.is_set():
            try:
                path = task_queue.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                processor.process(path)
            finally:
                task_queue.task_done()

    worker_thread = threading.Thread(target=worker, name="processor", daemon=True)
    worker_thread.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logging.info("stopping...")
    finally:
        stop_event.set()
        observer.stop()
        observer.join()
        worker_thread.join(timeout=5)
    return 0


if __name__ == "__main__":
    sys.exit(main())
