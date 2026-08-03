(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MVP2Core = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
  const WINDOWS_FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

  function normalizeAuthorName(value) {
    const name = String(value == null ? "" : value).trim();
    if (!name) throw new Error("保存者の名前を入力してください。");
    if (name.length > 50) throw new Error("保存者の名前は50文字以内で入力してください。");
    if (CONTROL_CHARACTERS.test(name)) throw new Error("保存者の名前に使用できない文字があります。");
    return name;
  }

  function sanitizeFilePart(value) {
    const sanitized = String(value == null ? "" : value)
      .replace(WINDOWS_FORBIDDEN, "")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[. ]+$/g, "");
    return sanitized || "user";
  }

  function uuid() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function compactTimestamp(date) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function createEnvelope(context, state, authorName, saveKind, payload, now) {
    const author = normalizeAuthorName(authorName);
    if (saveKind !== "workCopy" && saveKind !== "complete") {
      throw new Error("保存方法が正しくありません。");
    }
    const exportedAt = (now || new Date()).toISOString();
    return {
      formatVersion: 2,
      saveDataId: uuid(),
      parentSaveDataId: state.lastSaveDataId || null,
      sessionId: String(context.sessionId),
      databaseId: String(context.databaseId),
      dataType: String(context.dataType),
      schemaVersion: Number(context.schemaVersion),
      baseRevision: Number(context.baseRevision),
      exportSequence: Number(state.exportSequence) + 1,
      authorName: author,
      exportedAt,
      saveKind,
      readOnly: false,
      payload
    };
  }

  function makeFileName(envelope) {
    const kind = envelope.saveKind === "complete" ? "complete" : "workCopy";
    const timestamp = compactTimestamp(new Date(envelope.exportedAt));
    return [
      "MVP2SAVE",
      String(envelope.databaseId).replace(/-/g, "").slice(0, 8),
      `r${envelope.baseRevision}`,
      `s${envelope.exportSequence}`,
      kind,
      timestamp,
      sanitizeFilePart(envelope.authorName),
      String(envelope.saveDataId).replace(/-/g, "").slice(0, 8)
    ].join("_") + ".json";
  }

  function readState(storage, sessionId) {
    const key = `mvp2:${sessionId}`;
    try {
      const parsed = JSON.parse(storage.getItem(key) || "null");
      if (parsed && Number.isInteger(parsed.exportSequence) && parsed.exportSequence >= 0) {
        return {
          exportSequence: parsed.exportSequence,
          lastSaveDataId: typeof parsed.lastSaveDataId === "string" ? parsed.lastSaveDataId : null
        };
      }
    } catch (_) {
      // 壊れたブラウザ内情報は、業務データではないため初期化する。
    }
    return { exportSequence: 0, lastSaveDataId: null };
  }

  function writeState(storage, sessionId, state) {
    const key = `mvp2:${sessionId}`;
    storage.setItem(key, JSON.stringify({
      exportSequence: state.exportSequence,
      lastSaveDataId: state.lastSaveDataId
    }));
  }

  return {
    normalizeAuthorName,
    sanitizeFilePart,
    uuid,
    compactTimestamp,
    createEnvelope,
    makeFileName,
    readState,
    writeState
  };
});
