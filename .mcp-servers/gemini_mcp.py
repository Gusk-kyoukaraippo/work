#!/usr/bin/env python3
"""
Gemini CLI を MCP サーバーとしてラップするスクリプト。
Claude Code から Gemini に質問を投げられるようにする。
"""

import json
import sys
import subprocess
import os

def read_message():
    """stdin から JSON-RPC メッセージを読む"""
    line = sys.stdin.readline()
    if not line:
        return None
    return json.loads(line.strip())

def write_message(msg):
    """stdout に JSON-RPC メッセージを書く"""
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()

def send_response(req_id, result):
    write_message({"jsonrpc": "2.0", "id": req_id, "result": result})

def send_error(req_id, code, message):
    write_message({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})

def call_gemini(prompt: str, model: str = None) -> str:
    """Gemini CLI を非対話モードで呼び出す"""
    cmd = ["gemini", "-p", prompt]
    if model:
        cmd.extend(["-m", model])

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=120,
        env={**os.environ}
    )

    if result.returncode != 0:
        return f"[Gemini Error]\n{result.stderr}"
    return result.stdout.strip()

TOOLS = [
    {
        "name": "ask_gemini",
        "description": "Google Gemini に質問する。コード解析、設計相談、セカンドオピニオンに使う。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Gemini への質問・依頼内容"
                },
                "model": {
                    "type": "string",
                    "description": "使用モデル (省略可。例: gemini-2.0-flash-exp)",
                }
            },
            "required": ["prompt"]
        }
    }
]

def handle_initialize(req):
    send_response(req["id"], {
        "protocolVersion": "2024-11-05",
        "capabilities": {"tools": {}},
        "serverInfo": {"name": "gemini-mcp", "version": "1.0.0"}
    })

def handle_tools_list(req):
    send_response(req["id"], {"tools": TOOLS})

def handle_tools_call(req):
    params = req.get("params", {})
    tool_name = params.get("name")
    args = params.get("arguments", {})

    if tool_name == "ask_gemini":
        prompt = args.get("prompt", "")
        model = args.get("model")
        if not prompt:
            send_error(req["id"], -32602, "prompt は必須です")
            return

        response = call_gemini(prompt, model)
        send_response(req["id"], {
            "content": [{"type": "text", "text": response}]
        })
    else:
        send_error(req["id"], -32601, f"不明なツール: {tool_name}")

def main():
    while True:
        msg = read_message()
        if msg is None:
            break

        method = msg.get("method")

        if method == "initialize":
            handle_initialize(msg)
        elif method == "initialized":
            pass  # notification, no response needed
        elif method == "tools/list":
            handle_tools_list(msg)
        elif method == "tools/call":
            handle_tools_call(msg)
        elif method == "ping":
            send_response(msg.get("id"), {})
        else:
            if "id" in msg:
                send_error(msg["id"], -32601, f"Method not found: {method}")

if __name__ == "__main__":
    main()
