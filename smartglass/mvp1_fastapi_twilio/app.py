import os
import re
from enum import Enum
from html import escape
from pathlib import Path
from urllib.parse import urlencode

from dotenv import dotenv_values
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client

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


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


TWILIO_ACCOUNT_SID = required_env("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = required_env("TWILIO_AUTH_TOKEN")
TWILIO_FROM_NUMBER = required_env("TWILIO_FROM_NUMBER")
MY_PHONE_NUMBER = required_env("MY_PHONE_NUMBER")
WATCH_SECRET = required_env("WATCH_SECRET")

PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL")
DEFAULT_MESSAGE = os.getenv("DEFAULT_MESSAGE", "処理が完了しました。")
E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")

client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
app = FastAPI(title="Smartglass Twilio Watch Notifier")


class NotifyMode(str, Enum):
    say = "say"
    ring = "ring"


class WatchPost(BaseModel):
    token: str = Field(..., description="Shared secret from Apple Watch Shortcut")
    message: str | None = Field(None, description="Text to read when the call is answered")
    mode: NotifyMode = Field(NotifyMode.say, description="say reads the message, ring only rings then hangs up")


def base_url_from_request(request: Request) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL.rstrip("/")
    return str(request.base_url).rstrip("/")


def validate_phone_number(value: str, name: str) -> None:
    if not E164_PATTERN.fullmatch(value):
        raise HTTPException(
            status_code=500,
            detail=f"{name} must be E.164 format, for example +819012345678",
        )


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/watch-button")
async def watch_button(payload: WatchPost, request: Request) -> dict[str, str | bool]:
    if payload.token != WATCH_SECRET:
        raise HTTPException(status_code=403, detail="Invalid token")

    message = payload.message or DEFAULT_MESSAGE
    base_url = base_url_from_request(request)
    query = urlencode({"message": message, "mode": payload.mode.value})
    twiml_url = f"{base_url}/twiml?{query}"

    validate_phone_number(MY_PHONE_NUMBER, "MY_PHONE_NUMBER")
    validate_phone_number(TWILIO_FROM_NUMBER, "TWILIO_FROM_NUMBER")

    try:
        call = client.calls.create(
            to=MY_PHONE_NUMBER,
            from_=TWILIO_FROM_NUMBER,
            url=twiml_url,
        )
    except TwilioRestException as exc:
        raise HTTPException(status_code=502, detail=f"Twilio error {exc.code}: {exc.msg}") from exc

    return {
        "ok": True,
        "call_sid": call.sid,
        "twiml_url": twiml_url,
    }


@app.get("/twiml")
async def twiml(message: str = DEFAULT_MESSAGE, mode: NotifyMode = NotifyMode.say) -> Response:
    if mode == NotifyMode.ring:
        body = """
<Response>
  <Pause length="5"/>
  <Hangup/>
</Response>
""".strip()
    else:
        safe_message = escape(message)
        body = f"""
<Response>
  <Say language="ja-JP">{safe_message}</Say>
  <Pause length="1"/>
  <Hangup/>
</Response>
""".strip()

    xml = f'<?xml version="1.0" encoding="UTF-8"?>\n{body}\n'
    return Response(content=xml, media_type="application/xml")
