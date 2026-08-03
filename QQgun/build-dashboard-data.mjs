import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const dataDir = path.join(root, "gunma-isesaki");
const targetHospital = "美原記念";

const detailFiles = fs
  .readdirSync(dataDir)
  .filter((name) => name.endsWith("_details.json"))
  .sort();

const snapshots = [];
const rawRoutes = [];

for (const file of detailFiles) {
  const fullPath = path.join(dataDir, file);
  const detail = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const snapshotId = file.match(/_(\d{8}_\d{6})_details/)?.[1] ?? file;
  snapshots.push({
    file,
    snapshotId,
    displayText: detail.displayText,
    startedAt: detail.startedAt,
    finishedAt: detail.finishedAt,
    summary: detail.summary,
  });

  for (const row of detail.patientRoutes ?? []) {
    rawRoutes.push({
      ...row,
      snapshotId,
      snapshotDisplayText: detail.displayText,
    });
  }
}

const includesAny = (value, terms) => {
  const text = String(value ?? "");
  return terms.some((term) => text.includes(term));
};

const extract = (value, regex) => String(value ?? "").match(regex)?.[1]?.trim() ?? "";

const dispatchDate = (row) =>
  extract(row.dispatchInfo, /\[入電日付\]\s*([^\[]+)/) || String(row.patientKey ?? "").split("_")[0] || "";

const dispatchNumber = (row) =>
  extract(row.dispatchInfo, /\[出動番号\]\s*([^\[]+)/) || extract(row.patientKey, /_(第[^_]+)/) || "";

const patientNumber = (row) =>
  extract(row.dispatchInfo, /\[傷病者番号\]\s*([^\[]+)/) || String(row.patientKey ?? "").split("_").at(-1) || "";

const caseKey = (row) => `${dispatchDate(row)}_${dispatchNumber(row)}`;

const uniqueValues = (values) => [...new Set(values.filter(Boolean))];
const clinicPattern = /(クリニック|医院|診療所)/;

const referralClinicInfo = (row) => {
  const requestInstitutions = uniqueValues((row.requests ?? []).map((request) => request.institution));
  const clinicNames = requestInstitutions.filter((name) => clinicPattern.test(name));
  const hasFamilyDoctorReason = (row.requests ?? []).some((request) => String(request.reason ?? "").includes("かかりつけ"));
  return {
    hasReferralClinic: clinicNames.length > 0,
    referralClinicStatus: clinicNames.length > 0 ? "紹介クリニックあり" : "紹介クリニック記載なし",
    referralClinicName:
      clinicNames.join(" / ") || (hasFamilyDoctorReason ? "記載なし（かかりつけ理由あり）" : "記載なし"),
  };
};

const parseDate = (value) => {
  const match = String(value ?? "").match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

const parseClock = (value) => {
  const match = String(value ?? "").match(/(前)?(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return {
    previousDay: Boolean(match[1]),
    hour: Number(match[2]),
    minute: Number(match[3]),
  };
};

const dateTimeFromRoute = (row, value) => {
  const base = parseDate(row.dispatchDate || row.patientKey);
  const clock = parseClock(value);
  if (!base || !clock) return null;
  base.setHours(clock.hour, clock.minute, 0, 0);
  if (clock.previousDay) base.setDate(base.getDate() - 1);
  return base;
};

const departureMinusConsultationMinutes = (row) => {
  const targetRequest = row.requests?.find((req) => req.institution === targetHospital) ?? row.requests?.[0];
  const consultation = dateTimeFromRoute(row, targetRequest?.requestTime);
  const departureText = String(row.timeline ?? "").match(/現発：((?:前)?\d{1,2}:\d{2})/)?.[1];
  const departure = dateTimeFromRoute(row, departureText);
  if (!consultation || !departure) return null;
  return Math.round((departure - consultation) / 60000);
};

const byNewestRoute = (a, b) => {
  const aTime = dateTimeFromRoute(a, a.sourceTime)?.getTime() ?? 0;
  const bTime = dateTimeFromRoute(b, b.sourceTime)?.getTime() ?? 0;
  return bTime - aTime;
};

const rawRoutesByPatientKey = new Map();
for (const row of rawRoutes) {
  rawRoutesByPatientKey.set(row.patientKey, row);
}

const caseGroups = new Map();
for (const row of rawRoutesByPatientKey.values()) {
  const key = caseKey(row);
  if (!caseGroups.has(key)) caseGroups.set(key, []);
  caseGroups.get(key).push(row);
}

const mergeCaseRows = (rows) => {
  const sorted = [...rows].sort(byNewestRoute);
  const representative = sorted[0];
  const patientKeys = uniqueValues(rows.map((row) => row.patientKey));
  const patientNumbers = uniqueValues(rows.map(patientNumber));
  const diagnoses = uniqueValues(rows.map((row) => row.firstDiagnosis));
  const scenes = uniqueValues(rows.map((row) => row.scene));
  const severities = uniqueValues(rows.map((row) => row.sourceSeverity));
  const categories = uniqueValues(rows.map((row) => row.sourceCategory));
  const allRequests = rows.flatMap((row) => row.requests ?? []);

  const merged = {
    ...representative,
    caseKey: caseKey(representative),
    dispatchDate: dispatchDate(representative),
    dispatchNumber: dispatchNumber(representative),
    patientKeys,
    patientNumbers,
    patientCount: patientNumbers.length || patientKeys.length || 1,
    firstDiagnosis: diagnoses.join(" / ") || representative.firstDiagnosis,
    scene: scenes.join(" / ") || representative.scene,
    sourceSeverity: severities.join(" / ") || representative.sourceSeverity,
    sourceCategory: categories.join(" / ") || representative.sourceCategory,
    requests: allRequests,
    mergedRows: rows.map((row) => ({
      patientKey: row.patientKey,
      patientNumber: patientNumber(row),
      firstDiagnosis: row.firstDiagnosis,
      sourceTime: row.sourceTime,
    })),
  };
  Object.assign(merged, referralClinicInfo(merged));
  merged.departureMinusConsultationMinutes = departureMinusConsultationMinutes(merged);
  return merged;
};

const routes = Array.from(caseGroups.values()).map(mergeCaseRows);

const avg = (values) => {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10) / 10;
};

const countBy = (items, getKey) =>
  Object.entries(
    items.reduce((acc, item) => {
      const key = getKey(item) || "未記載";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"));

const latestTime = (items) => [...items].sort(byNewestRoute)[0]?.sourceTime ?? "";

const summaryFromRoutes = (items) =>
  countBy(items, (row) => row.sourceHospital).map(({ label: hospital }) => {
    const hospitalRows = items.filter((row) => row.sourceHospital === hospital);
    const acceptedRows = hospitalRows.filter((row) => row.sourceAccepted?.startsWith("○"));
    const rejectedRows = hospitalRows.filter((row) => row.sourceAccepted?.startsWith("×"));
    return {
      hospital,
      acceptedCount: acceptedRows.length,
      acceptedLatest: latestTime(acceptedRows),
      rejectedCount: rejectedRows.length,
      rejectedLatest: latestTime(rejectedRows),
    };
  });

const miharaRoutes = routes.filter((row) => row.sourceHospital === targetHospital);
const miharaAccepted = miharaRoutes.filter((row) => row.sourceAccepted?.startsWith("○"));
const miharaRejected = miharaRoutes.filter((row) => row.sourceAccepted?.startsWith("×"));

const miharaRejectedThenElsewhere = routes
  .filter((row) => {
    const rejectedHere = row.requests?.some(
      (req) => req.institution === targetHospital && String(req.result).startsWith("×"),
    );
    return rejectedHere && row.acceptedHospital && row.acceptedHospital !== targetHospital;
  })
  .sort(byNewestRoute);

const neuroTerms = ["脳卒中", "脳梗塞", "脳出血", "脳疾患", "めまい", "眩暈"];
const neuroNotMihara = routes
  .filter((row) => {
    const matches =
      includesAny(row.sourceCategory, ["脳疾患"]) ||
      includesAny(row.firstDiagnosis, neuroTerms) ||
      includesAny(row.initialOpinion, neuroTerms);
    return matches && row.acceptedHospital !== targetHospital;
  })
  .sort(byNewestRoute);

const latestSnapshot = snapshots.at(-1) ?? null;
const latestSummary = latestSnapshot?.summary ?? [];
const latestMihara = latestSummary.find((row) => row.hospital === targetHospital) ?? null;
const sortedMiharaRoutes = [...miharaRoutes].sort(byNewestRoute);

const dashboardData = {
  generatedAt: new Date().toISOString(),
  targetHospital,
  sourceFiles: detailFiles,
  snapshots,
  latestSnapshot,
  latestSummary,
  latestMihara,
  areaSummary: summaryFromRoutes(routes),
  metrics: {
    totalRoutes: routes.length,
    miharaRoutes: miharaRoutes.length,
    miharaAccepted: miharaAccepted.length,
    miharaRejected: miharaRejected.length,
    miharaAcceptRate:
      miharaRoutes.length > 0 ? Math.round((miharaAccepted.length / miharaRoutes.length) * 1000) / 10 : 0,
    miharaAvgDepartureMinusConsultationMinutes: avg(
      miharaRoutes.map((row) => row.departureMinusConsultationMinutes),
    ),
    rejectedThenElsewhere: miharaRejectedThenElsewhere.length,
    neuroNotMihara: neuroNotMihara.length,
  },
  mihara: {
    routes: sortedMiharaRoutes,
    accepted: miharaAccepted,
    rejected: miharaRejected,
    severityCounts: countBy(miharaRoutes, (row) => row.sourceSeverity),
    categoryCounts: countBy(miharaRoutes, (row) => row.sourceCategory),
    reasonCounts: countBy(
      miharaRoutes.flatMap((row) => row.requests ?? []).filter((req) => req.institution === targetHospital),
      (req) => req.reason,
    ),
  },
  rejectedThenElsewhere: miharaRejectedThenElsewhere,
  neuroNotMihara: {
    rows: neuroNotMihara,
    byReferralClinic: countBy(neuroNotMihara, (row) => row.referralClinicStatus),
    byAcceptedHospital: countBy(neuroNotMihara, (row) => row.acceptedHospital),
    byDiagnosis: countBy(neuroNotMihara, (row) => row.firstDiagnosis),
    bySourceHospital: countBy(neuroNotMihara, (row) => row.sourceHospital),
  },
};

const output = `window.DASHBOARD_DATA = ${JSON.stringify(dashboardData, null, 2)};\n`;
fs.writeFileSync(path.join(root, "dashboard-data.js"), output);
console.log(`Wrote dashboard-data.js from ${detailFiles.length} snapshots and ${routes.length} routes.`);
