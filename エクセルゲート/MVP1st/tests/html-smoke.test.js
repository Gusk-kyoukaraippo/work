const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const template = fs.readFileSync(
  new URL("../html/app.template.html", `file://${__filename}`),
  "utf8"
);
const scripts = [...template.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const appScript = scripts.at(-1)[1] + "\nglobalThis.__appState = state;";
const token = "__APP_CONTEXT_JSON__";

class MockElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.innerHTML = "";
    this.className = "";
    this.value = "";
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    children.forEach(child => this.appendChild(child));
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  click() {
    if (this.listeners.click) this.listeners.click({ currentTarget: this });
    if (this.tagName === "A") this.ownerDocument.lastDownload = this;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
  }
}

class MockBlob {
  constructor(parts, options) {
    this.parts = parts;
    this.type = options?.type ?? "";
  }
}

function createRuntime(contextJson = null) {
  const elements = {};
  const make = (id, tag = "div") => (elements[id] = new MockElement(tag, id));

  const body = new MockElement("body", "body");
  const contextElement = make("app-context", "script");
  contextElement.textContent = contextJson ?? token;
  make("book-info");
  make("mode-badge", "span");
  make("record-count", "span");
  const editOnly = make("edit-only");
  make("add-button", "button");
  make("export-button", "button");
  make("data-table", "table");
  make("empty-state");
  make("operation-notice", "p");
  const thead = make("thead", "thead");
  const tbody = make("tbody", "tbody");

  const document = {
    body,
    title: "",
    lastDownload: null,
    createElement(tagName) {
      const element = new MockElement(tagName);
      element.ownerDocument = document;
      return element;
    },
    getElementById(id) {
      return elements[id];
    },
    querySelector(selector) {
      if (selector === "#data-table thead") return thead;
      if (selector === "#data-table tbody") return tbody;
      throw new Error(`Unexpected selector: ${selector}`);
    },
    querySelectorAll(selector) {
      if (selector === ".edit-only") return [editOnly];
      throw new Error(`Unexpected selector: ${selector}`);
    }
  };
  body.ownerDocument = document;

  let lastBlob = null;
  const alerts = [];
  const runtime = vm.createContext({
    document,
    Blob: MockBlob,
    URL: {
      createObjectURL(blob) {
        lastBlob = blob;
        return "blob:mock";
      },
      revokeObjectURL() {}
    },
    window: {
      alert(message) { alerts.push(String(message)); },
      confirm() { return true; },
      setTimeout(callback) { callback(); }
    },
    console
  });

  vm.runInContext(appScript, runtime);
  return { runtime, document, elements, thead, tbody, alerts, getLastBlob: () => lastBlob };
}

function testEditableMode() {
  const app = createRuntime();
  assert.equal(app.elements["mode-badge"].textContent, "編集モード");
  assert.equal(app.elements["edit-only"].hidden, false);
  assert.equal(app.tbody.children.length, 2);
  assert.equal(app.tbody.children[0].children[0].children[0].disabled, false);

  app.elements["add-button"].click();
  assert.equal(app.runtime.__appState.records.length, 3);
  assert.match(app.runtime.__appState.records[2].id, /^new-/);

  app.elements["export-button"].click();
  assert.equal(app.alerts.length, 0);
  const blob = app.getLastBlob();
  assert.ok(blob);
  const payload = JSON.parse(blob.parts.join(""));
  assert.equal(payload.databaseId, app.runtime.__appState.databaseId);
  assert.equal(payload.revision, 125);
  assert.equal(payload.readOnly, false);
  assert.equal(payload.records.length, 3);
  assert.equal(app.document.lastDownload.download, "justcalc-changes-r125.json");
}

function testReadOnlyMode() {
  const payload = {
    databaseId: "test-book",
    schemaVersion: 1,
    revision: 9,
    readOnly: true,
    fields: ["id", "name", "note"],
    records: [{ id: "001", name: "山田", note: "閲覧のみ" }]
  };
  const app = createRuntime(JSON.stringify(payload));
  assert.equal(app.elements["mode-badge"].textContent, "閲覧モード");
  assert.equal(app.elements["edit-only"].hidden, true);
  assert.equal(app.tbody.children.length, 1);
  assert.equal(app.tbody.children[0].children.length, 3);
  assert.equal(app.tbody.children[0].children[0].children[0].disabled, true);
  assert.equal(app.getLastBlob(), null);
}

testEditableMode();
testReadOnlyMode();
console.log("HTML smoke tests: OK");
