(() => {
  const targets = [
    "伊勢崎市民",
    "鶴谷病院",
    "医師会病院",
    "石井病院",
    "美原記念",
    "伊勢崎福島"
  ];

  const minIntervalMs = 24 * 60 * 60 * 1000;
  const checkIntervalMs = 60 * 60 * 1000;
  const storageKey = "gunma-isesaki-autosaver-last-run";
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const rowsOf = (table) =>
    Array.from(table.rows).map((row) =>
      Array.from(row.cells).map((cell) => clean(cell.innerText))
    );

  const allTables = () =>
    Array.from(document.querySelectorAll("table")).map((table, index) => ({
      index,
      element: table,
      rows: rowsOf(table)
    }));

  const findSummaryTable = () =>
    allTables().find((table) => {
      const joined = table.rows.map((row) => row.join(" ")).join(" ");
      const targetHits = targets.filter((target) => joined.includes(target)).length;
      return joined.includes("医療機関") && joined.includes("市町村") && targetHits >= 4;
    });

  const findRecordTable = () =>
    allTables().find((table) => {
      const first = table.rows[0]?.join(" ") || "";
      const header = table.rows[2]?.join(" ") || "";
      return first.includes("搬送実績一覧") && header.includes("時刻") && header.includes("受入");
    });

  const findDetailTable = () =>
    allTables().find((table) => (table.rows[0]?.join(" ") || "").includes("搬送実績詳細"));

  const textOf = (element) =>
    clean(
      element.value ||
        element.getAttribute("aria-label") ||
        element.title ||
        element.innerText ||
        element.textContent
    );

  const clickByText = (text) => {
    const candidates = Array.from(
      document.querySelectorAll("button, input, a, td, th, span, div, li")
    );
    const element = candidates.find((candidate) => textOf(candidate) === text);
    if (!element) return false;
    element.scrollIntoView?.({ block: "center", inline: "center" });
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    element.click?.();
    return true;
  };

  const clickElement = (element) => {
    element.scrollIntoView?.({ block: "center", inline: "center" });
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    element.click?.();
  };

  const clickIsesakiRegionTab = () => {
    const regionOrder = [
      "前橋",
      "高崎中",
      "渋川",
      "藤岡",
      "富岡",
      "吾妻",
      "沼田",
      "伊勢崎",
      "桐生",
      "太田館林",
      "全域",
      "埼玉県",
      "栃木",
      "長野県",
      "新潟県",
      "茨城"
    ];
    const blankMonitorLinks = Array.from(document.querySelectorAll("a")).filter(
      (link) =>
        !textOf(link) &&
        String(link.href || "").includes("/member/ec_transport_result_monitor")
    );
    const element = blankMonitorLinks[regionOrder.indexOf("伊勢崎")];
    if (!element) return false;
    clickElement(element);
    return true;
  };

  const ensureRecordListMode = async () => {
    if (findRecordTable()) return;
    clickByText("実績一覧");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(200);
      if (findSummaryTable()) return;
    }
  };

  const ensureIsesakiRegion = async () => {
    const table = findSummaryTable();
    if (table && targets.filter((target) => table.rows.some((row) => row[0] === target)).length >= 4) {
      return;
    }

    if (!clickByText("伊勢崎") && !clickIsesakiRegionTab()) {
      throw new Error("伊勢崎タブが見つかりません");
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(200);
      const summaryTable = findSummaryTable();
      const visibleTargets =
        summaryTable?.rows.filter((row) => targets.includes(row[0])).map((row) => row[0]) || [];
      if (visibleTargets.length >= 4) return;
    }
    throw new Error("伊勢崎タブに切り替わりませんでした");
  };

  const closeDetail = () => {
    const detail = findDetailTable();
    const button = detail?.element.querySelector("button");
    if (button) button.click();
  };

  const normalizeRecord = (hospital, row, index) => ({
    hospital,
    recordIndex: index,
    time: row[0] || "",
    accepted: row[1] || "",
    severity: row.length >= 5 ? row[2] || "" : "",
    category: row.length >= 5 ? row[3] || "" : row[2] || "",
    unit: row.length >= 5 ? row[4] || "" : row[3] || ""
  });

  const clickHospital = async (hospital) => {
    closeDetail();
    const summaryTable = findSummaryTable();
    if (!summaryTable) throw new Error("医療機関一覧テーブルが見つかりません");

    const row = Array.from(summaryTable.element.rows).find(
      (candidate) => clean(candidate.cells[0]?.innerText) === hospital
    );
    if (!row) throw new Error(`${hospital} の行が見つかりません`);

    row.cells[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(200);
      const title = findRecordTable()?.rows[0]?.join("") || "";
      if (title.includes(hospital)) return;
    }
    throw new Error(`${hospital} の搬送実績一覧に切り替わりませんでした`);
  };

  const extractSummary = () => {
    const summaryTable = findSummaryTable();
    if (!summaryTable) throw new Error("医療機関一覧テーブルが見つかりません");

    return summaryTable.rows
      .slice(2)
      .filter((row) => targets.includes(row[0]))
      .map((row) => ({
        hospital: row[0],
        city: row[2] || "",
        acceptedCount: row[3] || "",
        acceptedLatest: row[4] || "",
        rejectedCount: row[5] || "",
        rejectedLatest: row[6] || ""
      }));
  };

  const extractRecords = (hospital) => {
    const recordTable = findRecordTable();
    if (!recordTable) throw new Error(`${hospital} の搬送実績テーブルが見つかりません`);

    return {
      title: recordTable.rows[0]?.join("") || "",
      countText: recordTable.rows[1]?.join("") || "",
      rows: recordTable.rows.slice(3).map((row, index) => normalizeRecord(hospital, row, index))
    };
  };

  const sectionRow = (detailRows, label) =>
    detailRows.find((row) => row[0] === label || row[0]?.includes(label));

  const parseBracket = (text, label) => {
    const match = clean(text).match(new RegExp(`\\[${label}\\]\\s*([^\\[\\]]+)`));
    return match ? clean(match[1]) : "";
  };

  const firstAccepted = (requests) =>
    requests.find((request) => /^○/.test(request.result)) ||
    requests.find((request) => request.result.includes("受入"));

  const parseDetail = (sourceRecord) => {
    const detail = findDetailTable();
    if (!detail) throw new Error("搬送実績詳細が見つかりません");

    const rows = rowsOf(detail.element);
    const dispatchInfo = sectionRow(rows, "出動情報")?.[1] || "";
    const incidentPlace = sectionRow(rows, "事故種別・発生場所")?.[1] || "";
    const scene = sectionRow(rows, "出動先")?.[1] || "";
    const genderAge = sectionRow(rows, "傷病者性別年齢")?.[1] || "";
    const patientBackground = sectionRow(rows, "傷病者背景")?.[1] || "";
    const initialOpinion = sectionRow(rows, "初診医所見")?.[1] || "";
    const timeProgress = sectionRow(rows, "時間経過")?.[1] || "";

    const destinationCell = Array.from(detail.element.rows).find((row) =>
      clean(row.cells[0]?.innerText).includes("搬送先機関")
    )?.cells[1];
    const destinationTable = destinationCell?.querySelector("table");
    const requests = destinationTable
      ? rowsOf(destinationTable)
          .slice(1)
          .filter((row) => /^\d+$/.test(row[0]))
          .map((row) => ({
            patientKey: "",
            sourceHospital: sourceRecord.hospital,
            sourceTime: sourceRecord.time,
            requestOrder: row[0] || "",
            institution: row[1] || "",
            reason: row[2] || "",
            result: row[3] || "",
            requestTime: row[4] || ""
          }))
      : [];

    const accepted = firstAccepted(requests);
    const rejectedHospitals = requests
      .filter((request) => /^×/.test(request.result))
      .map((request) => request.institution)
      .join(" > ");
    const requestFlow = requests
      .map((request) => `${request.requestOrder}:${request.institution}=${request.result}@${request.requestTime}`)
      .join(" > ");

    const patientKey = [
      parseBracket(dispatchInfo, "入電日付"),
      parseBracket(dispatchInfo, "出動番号").replace(/\s/g, ""),
      parseBracket(dispatchInfo, "傷病者番号").replace(/\s/g, "")
    ]
      .filter(Boolean)
      .join("_");

    requests.forEach((request) => {
      request.patientKey = patientKey;
    });

    return {
      patientKey,
      sourceHospital: sourceRecord.hospital,
      sourceTime: sourceRecord.time,
      sourceAccepted: sourceRecord.accepted,
      sourceSeverity: sourceRecord.severity,
      sourceCategory: sourceRecord.category,
      sourceUnit: sourceRecord.unit,
      acceptedHospital: accepted?.institution || "",
      acceptedRequestOrder: accepted?.requestOrder || "",
      acceptedRequestTime: accepted?.requestTime || "",
      rejectedHospitals,
      requestFlow,
      dispatchInfo,
      incidentPlace,
      scene,
      genderAge,
      sex: parseBracket(genderAge, "性別"),
      age: parseBracket(genderAge, "年齢"),
      ageGroup: parseBracket(genderAge, "年齢区分"),
      patientBackground,
      initialOpinion,
      firstDiagnosis:
        clean(initialOpinion.match(/初診時傷病名\s+(.+?)(?:\s+特記事項|\s+備考|$)/)?.[1]) || "",
      storageTime: clean(timeProgress.match(/収容所要時間\s+(\d+\s*分)/)?.[1]) || "",
      sceneStayTime: clean(timeProgress.match(/現場滞在時間\s+(\d+\s*分)/)?.[1]) || "",
      timeline: clean(
        timeProgress
          .replace(/収容所要時間\s+\d+\s*分/, "")
          .replace(/現場滞在時間\s+\d+\s*分/, "")
      ),
      requests
    };
  };

  const clickRecordDetail = async (record) => {
    closeDetail();
    const recordTable = findRecordTable();
    const row = recordTable?.element.rows[record.recordIndex + 3];
    const link = row?.cells[0]?.querySelector("a");
    if (!link) throw new Error(`${record.hospital} ${record.time} の時刻リンクが見つかりません`);

    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(200);
      if (findDetailTable()) return parseDetail(record);
    }
    throw new Error(`${record.hospital} ${record.time} の詳細が開きませんでした`);
  };

  const toCsv = (headers, rows) => {
    const esc = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    return [
      headers.map(esc).join(","),
      ...rows.map((row) => headers.map((header) => esc(row[header])).join(","))
    ].join("\n");
  };

  const sendDownload = (filename, content, mime) =>
    chrome.runtime.sendMessage({ type: "download", filename, content, mime });

  const stamp = () => {
    const pad = (value) => String(value).padStart(2, "0");
    const now = new Date();
    return [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      "_",
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds())
    ].join("");
  };

  const setStatus = (text, isError = false) => {
    let badge = document.getElementById("gunma-isesaki-autosaver-status");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "gunma-isesaki-autosaver-status";
      badge.style.cssText = [
        "position:fixed",
        "right:10px",
        "bottom:10px",
        "z-index:2147483647",
        "font:12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif",
        "padding:6px 8px",
        "border:1px solid #2b6b4f",
        "background:#f4fff8",
        "color:#143a2b",
        "box-shadow:0 1px 4px rgba(0,0,0,.2)"
      ].join(";");
      document.body.appendChild(badge);
    }
    badge.textContent = text;
    badge.style.borderColor = isError ? "#8a2b2b" : "#2b6b4f";
    badge.style.background = isError ? "#fff4f4" : "#f4fff8";
    badge.style.color = isError ? "#541818" : "#143a2b";
  };

  const run = async () => {
    if (window.__gunmaIsesakiAutosaverRunning) return;

    const lastRun = Number(localStorage.getItem(storageKey) || 0);
    if (Date.now() - lastRun < minIntervalMs) {
      setStatus("伊勢崎データ: 次回保存待ち");
      return;
    }

    window.__gunmaIsesakiAutosaverRunning = true;
    setStatus("伊勢崎データ: 保存中");

    try {
      const startedAt = new Date().toISOString();
      await ensureIsesakiRegion();
      await ensureRecordListMode();
      const pageText = clean(document.body.innerText);
      const summary = extractSummary();
      const recordsByHospital = {};
      const recordDetails = [];
      const patientMap = new Map();
      const destinationRequests = [];
      const errors = [];

      for (const hospital of targets) {
        try {
          await clickHospital(hospital);
          const entry = extractRecords(hospital);
          recordsByHospital[hospital] = entry;

          for (const record of entry.rows) {
            try {
              const detail = await clickRecordDetail(record);
              recordDetails.push(detail);
              if (detail.patientKey && !patientMap.has(detail.patientKey)) {
                patientMap.set(detail.patientKey, detail);
                destinationRequests.push(...detail.requests);
              }
            } catch (error) {
              errors.push({ hospital, time: record.time, message: error.message });
            }
          }
        } catch (error) {
          errors.push({ hospital, message: error.message });
        }
      }

      closeDetail();
      const finishedAt = new Date().toISOString();
      const recordRows = Object.values(recordsByHospital).flatMap((entry) => entry.rows);
      const patientRoutes = Array.from(patientMap.values());
      const base = `gunma_isesaki_${stamp()}`;
      const bundle = {
        title: document.title,
        url: location.href,
        startedAt,
        finishedAt,
        displayText:
          pageText.match(/搬送実績モニター表示時刻：\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/)?.[0] || "",
        targets,
        summary,
        recordsByHospital,
        recordDetails,
        patientRoutes,
        destinationRequests,
        errors
      };

      await sendDownload(`${base}_details.json`, JSON.stringify(bundle, null, 2), "application/json;charset=utf-8");
      await sendDownload(
        `${base}_summary.csv`,
        toCsv(
          ["hospital", "city", "acceptedCount", "acceptedLatest", "rejectedCount", "rejectedLatest"],
          summary
        ),
        "text/csv;charset=utf-8"
      );
      await sendDownload(
        `${base}_records.csv`,
        toCsv(["hospital", "time", "accepted", "severity", "category", "unit"], recordRows),
        "text/csv;charset=utf-8"
      );
      await sendDownload(
        `${base}_patient_routes.csv`,
        toCsv(
          [
            "patientKey",
            "sourceHospital",
            "sourceTime",
            "sourceAccepted",
            "acceptedHospital",
            "acceptedRequestOrder",
            "acceptedRequestTime",
            "rejectedHospitals",
            "requestFlow",
            "scene",
            "genderAge",
            "firstDiagnosis",
            "storageTime",
            "sceneStayTime"
          ],
          patientRoutes
        ),
        "text/csv;charset=utf-8"
      );
      await sendDownload(
        `${base}_destination_requests.csv`,
        toCsv(
          [
            "patientKey",
            "sourceHospital",
            "sourceTime",
            "requestOrder",
            "institution",
            "reason",
            "result",
            "requestTime"
          ],
          destinationRequests
        ),
        "text/csv;charset=utf-8"
      );

      localStorage.setItem(storageKey, String(Date.now()));
      setStatus(
        `伊勢崎データ: 保存完了 明細${recordRows.length}件 / 患者${patientRoutes.length}件${errors.length ? ` / エラー${errors.length}件` : ""}`,
        errors.length > 0
      );
    } catch (error) {
      setStatus(`伊勢崎データ: 保存失敗 ${error.message}`, true);
      console.error("[gunma-isesaki-autosaver]", error);
    } finally {
      window.__gunmaIsesakiAutosaverRunning = false;
    }
  };

  setTimeout(run, 3000);
  setInterval(run, checkIntervalMs);
})();
