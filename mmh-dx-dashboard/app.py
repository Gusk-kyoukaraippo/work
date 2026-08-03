from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from google.cloud import firestore
import json
import os
from datetime import datetime, timezone

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "mmh-dashboard-secret-2026")

db = firestore.Client(project="mmh-dx-dashboard")
REHAB_DOC = db.collection("rehab_inventory").document("state")
GOODS_DOC = db.collection("goods_management").document("state")
GOODS_V2_DOC = db.collection("goods_v2").document("state")
GOODS_V2_LOGS_DOC = db.collection("goods_v2").document("logs")

PASSWORD = "mmh"


@app.route("/", methods=["GET", "POST"])
def login():
    error = None
    next_url = request.args.get("next", "")
    if request.method == "POST":
        next_url = request.form.get("next", "")
        if request.form.get("password") == PASSWORD:
            session["authenticated"] = True
            return redirect(next_url if next_url.startswith("/") else url_for("dashboard"))
        else:
            error = "パスワードが違います"
    if session.get("authenticated"):
        return redirect(next_url if next_url.startswith("/") else url_for("dashboard"))
    return render_template("login.html", error=error, next_url=next_url)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/dashboard")
def dashboard():
    if not session.get("authenticated"):
        return redirect(url_for("login"))
    return render_template("dashboard.html")


@app.route("/api/rehab/data", methods=["GET"])
def api_rehab_get():
    if not session.get("authenticated"):
        return jsonify({"error": "unauthorized"}), 401
    doc = REHAB_DOC.get()
    if doc.exists:
        raw = doc.to_dict().get("data", "{}")
        return jsonify(json.loads(raw))
    return jsonify({})


@app.route("/api/rehab/data", methods=["POST"])
def api_rehab_save():
    if not session.get("authenticated"):
        return jsonify({"error": "unauthorized"}), 401
    payload = request.get_json(force=True)
    REHAB_DOC.set({"data": json.dumps(payload)})
    return jsonify({"ok": True})


@app.route("/app/rehab-inventory")
def app_rehab_inventory():
    if not session.get("authenticated"):
        return redirect(url_for("login"))
    return render_template("app_rehab_inventory.html")


@app.route("/api/goods/data", methods=["GET"])
def api_goods_get():
    if not session.get("authenticated"):
        return jsonify({"error": "unauthorized"}), 401
    doc = GOODS_DOC.get()
    if doc.exists:
        raw = doc.to_dict().get("data", "{}")
        return jsonify(json.loads(raw))
    return jsonify({})


@app.route("/api/goods/data", methods=["POST"])
def api_goods_save():
    if not session.get("authenticated"):
        return jsonify({"error": "unauthorized"}), 401
    payload = request.get_json(force=True)
    GOODS_DOC.set({"data": json.dumps(payload)})
    return jsonify({"ok": True})


@app.route("/api/goods-v2/data", methods=["GET"])
def api_goods_v2_get():
    if not session.get("authenticated"):
        return jsonify({"error": "unauthorized"}), 401
    doc = GOODS_V2_DOC.get()
    if doc.exists:
        return jsonify(json.loads(doc.to_dict().get("data", "{}")))
    return jsonify({})


@app.route("/api/goods-v2/data", methods=["POST"])
def api_goods_v2_save():
    if not session.get("authenticated"):
        return jsonify({"error": "unauthorized"}), 401
    payload = request.get_json(force=True)
    GOODS_V2_DOC.set({"data": json.dumps(payload)})
    return jsonify({"ok": True})


@app.route("/api/goods-v2/logs", methods=["GET"])
def api_goods_v2_logs_get():
    if not session.get("authenticated"):
        return jsonify({"error": "unauthorized"}), 401
    doc = GOODS_V2_LOGS_DOC.get()
    if doc.exists:
        return jsonify(json.loads(doc.to_dict().get("data", "[]")))
    return jsonify([])


@app.route("/api/goods-v2/logs", methods=["POST"])
def api_goods_v2_logs_save():
    if not session.get("authenticated"):
        return jsonify({"error": "unauthorized"}), 401
    payload = request.get_json(force=True)
    if not isinstance(payload, list):
        return jsonify({"error": "logs must be array"}), 400
    GOODS_V2_LOGS_DOC.set({"data": json.dumps(payload)})
    return jsonify({"ok": True})


@app.route("/api/goods/check", methods=["POST"])
def api_goods_check():
    if not session.get("authenticated"):
        return jsonify({"error": "unauthorized"}), 401
    payload = request.get_json(force=True)
    device_id = payload.get("deviceId", "").strip()
    location = payload.get("location", "").strip()
    checker = payload.get("checker", "").strip()
    if not device_id:
        return jsonify({"error": "deviceId required"}), 400
    doc = GOODS_DOC.get()
    state = json.loads(doc.to_dict().get("data", "{}")) if doc.exists else {}
    devices = state.get("devices", [])
    device = next((d for d in devices if d["id"] == device_id), None)
    if not device:
        return jsonify({"error": "device not found"}), 404
    scans = state.get("scans", [])
    scans.insert(0, {
        "deviceId": device_id,
        "ts": datetime.now(timezone.utc).isoformat(),
        "location": location,
        "checker": checker,
    })
    state["scans"] = scans
    GOODS_DOC.set({"data": json.dumps(state)})
    return jsonify({"ok": True, "deviceName": device.get("name", ""), "deviceType": device.get("type", "")})


@app.route("/scan")
def scan_page():
    if not session.get("authenticated"):
        return redirect(url_for("login") + "?next=" + request.full_path.rstrip("?"))
    device_id = request.args.get("id", "")
    return render_template("app_scan.html", device_id=device_id)


@app.route("/app/goods")
def app_goods():
    if not session.get("authenticated"):
        return redirect(url_for("login"))
    return render_template("app_goods.html")


@app.route("/app/goods-v2")
def app_goods_v2():
    if not session.get("authenticated"):
        return redirect(url_for("login"))
    return render_template("app_goods_v2.html")


@app.route("/app/goods-v2/qr-print")
def app_goods_v2_qr_print():
    if not session.get("authenticated"):
        return redirect(url_for("login"))
    return render_template("goods_v2_qr_print.html")


@app.route("/app/chicare")
def app_chicare():
    if not session.get("authenticated"):
        return redirect(url_for("login"))
    return render_template("app_chicare.html")


@app.route("/app/medical-rules")
def app_medical_rules():
    if not session.get("authenticated"):
        return redirect(url_for("login"))
    return render_template("app_medical_rules.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)
