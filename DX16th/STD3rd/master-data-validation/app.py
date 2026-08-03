import json
from datetime import date, datetime
from pathlib import Path
import copy

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

try:
    from fpdf import FPDF
except ModuleNotFoundError:
    FPDF = None

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
ACTUAL_DIR = DATA_DIR / "actual"
MASTER_DIR = DATA_DIR / "master"

PHASE_COLORS = {1: "#2b6cb0", 2: "#2f855a", 3: "#c05621"}


def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_month(value):
    return pd.Period(value, freq="M")


def month_range(start_month, end_month):
    return pd.period_range(start=start_month, end=end_month, freq="M")


def working_days(start_date, end_date, holidays):
    if start_date > end_date:
        return []
    dates = pd.date_range(start_date, end_date, freq="D")
    holiday_set = set(pd.to_datetime(holidays))
    weekdays = dates[dates.weekday < 5]
    return [d for d in weekdays if d.normalize() not in holiday_set]


def resample_s_curve(original_curve, actual_working_days):
    if actual_working_days <= 0:
        return np.array([])
    if len(original_curve) == actual_working_days:
        curve = np.array(original_curve, dtype=float)
        total = curve.sum()
        return curve / total if total else curve
    x_original = np.linspace(0, 1, len(original_curve))
    x_new = np.linspace(0, 1, actual_working_days)
    resampled = np.interp(x_new, x_original, original_curve)
    total = resampled.sum()
    return resampled / total if total else resampled


def load_default_ships():
    ship_files = sorted(ACTUAL_DIR.glob("ship_*.json"))
    return [read_json(path) for path in ship_files]


def load_default_materials():
    return {
        1: read_json(ACTUAL_DIR / "material_phase1_kogumi.json"),
        2: read_json(ACTUAL_DIR / "material_phase2_kumitate.json"),
        3: read_json(ACTUAL_DIR / "material_phase3_sotogyo.json"),
    }


def load_master():
    return read_json(MASTER_DIR / "master_data_v1.0.json")


def normalize_materials_json(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and "phase" in payload:
        return [payload]
    return []


def extract_materials_records(materials_by_phase):
    records = []
    for phase_id, payload in materials_by_phase.items():
        for phase_entry in normalize_materials_json(payload):
            for monthly in phase_entry.get("月次納入", []):
                month = parse_month(monthly.get("月"))
                for material, amount in monthly.get("資材", {}).items():
                    records.append(
                        {
                            "phase": phase_id,
                            "month": month,
                            "material": material,
                            "actual": float(amount),
                        }
                    )
    return pd.DataFrame(records)


def build_master_lookup(master_data):
    lookup = {}
    for ship_type in master_data.get("shipTypes", []):
        phases = {}
        for phase in ship_type.get("phases", []):
            phases[phase.get("phaseId")] = phase
        lookup[ship_type.get("id")] = phases
    return lookup


def apply_phase_coefficients(master_data, phase_coeffs):
    updated = copy.deepcopy(master_data)
    for ship in updated.get("shipTypes", []):
        ship_id = ship.get("id")
        for phase in ship.get("phases", []):
            phase_id = phase.get("phaseId")
            factor = phase_coeffs.get((ship_id, phase_id))
            if factor is None:
                continue
            for material in phase.get("materials", {}).values():
                base = float(material.get("coefficient", 1.0))
                material["coefficient"] = base * factor
    return updated


def evaluate_prediction_metrics(pred_df, actual_df, start_month, end_month):
    pred_monthly = pred_df.groupby(["month", "material"])["predicted"].sum().reset_index()
    merged = compute_errors(pred_monthly, actual_df, start_month, end_month)
    stats = compute_stats(merged)
    abs_error_sum = merged["abs_error"].sum() if not merged.empty else np.nan
    return stats, abs_error_sum


def generate_coeff_grid(min_val, max_val, steps):
    if steps <= 1:
        return [min_val]
    return list(np.linspace(min_val, max_val, steps))


def random_coefficients(target_keys, min_val, max_val, base, max_delta):
    coeffs = {}
    for key in target_keys:
        base_val = base.get(key, 1.0)
        lower = max(min_val, base_val * (1 - max_delta))
        upper = min(max_val, base_val * (1 + max_delta))
        coeffs[key] = np.random.uniform(lower, upper)
    return coeffs


def calculate_predicted_monthly(ships, master_data, holidays, start_month, end_month):
    master_lookup = build_master_lookup(master_data)
    month_set = set(month_range(start_month, end_month))
    records = []
    for ship in ships:
        ship_type = ship.get("船種")
        ship_name = ship.get("船名")
        for phase in ship.get("phases", []):
            phase_id = phase.get("phase")
            master_phase = master_lookup.get(ship_type, {}).get(phase_id)
            if not master_phase:
                continue
            start_date = pd.to_datetime(phase.get("開始日")).date()
            end_date = pd.to_datetime(phase.get("終了日")).date()
            working = working_days(start_date, end_date, holidays)
            s_curve = resample_s_curve(master_phase.get("sCurve", []), len(working))
            if len(s_curve) == 0:
                continue
            materials = master_phase.get("materials", {})
            for idx, work_day in enumerate(working):
                month = pd.Period(work_day, freq="M")
                if month not in month_set:
                    continue
                for material, meta in materials.items():
                    base = float(meta.get("baseAmount", 0.0))
                    coef = float(meta.get("coefficient", 1.0))
                    amount = base * coef * float(s_curve[idx])
                    records.append(
                        {
                            "month": month,
                            "material": material,
                            "phase": phase_id,
                            "shipType": ship_type,
                            "shipName": ship_name,
                            "predicted": amount,
                        }
                    )
    if not records:
        return pd.DataFrame(
            columns=["month", "material", "phase", "shipType", "shipName", "predicted"]
        )
    return pd.DataFrame(records)


def build_timeline_df(ships):
    rows = []
    for ship in ships:
        ship_name = ship.get("船名")
        phases = ship.get("phases", [])
        ranges = []
        for phase in phases:
            ranges.append(
                (
                    phase.get("phase"),
                    pd.to_datetime(phase.get("開始日")).date(),
                    pd.to_datetime(phase.get("終了日")).date(),
                )
            )
        for phase_id, start, end in ranges:
            days = pd.date_range(start, end, freq="D")
            if days.empty:
                continue
            overlap_flags = []
            for day in days:
                active = 0
                for _, other_start, other_end in ranges:
                    if other_start <= day.date() <= other_end:
                        active += 1
                overlap_flags.append(active > 1)

            segment_start = days[0].date()
            current_flag = overlap_flags[0]
            for idx, day in enumerate(days[1:], start=1):
                if overlap_flags[idx] != current_flag:
                    rows.append(
                        {
                            "Ship": ship_name,
                            "Phase": f"Phase {phase_id}",
                            "PhaseId": phase_id,
                            "Status": "重複" if current_flag else "単独",
                            "Start": segment_start.isoformat(),
                            "End": days[idx - 1].date().isoformat(),
                        }
                    )
                    segment_start = day.date()
                    current_flag = overlap_flags[idx]
            rows.append(
                {
                    "Ship": ship_name,
                    "Phase": f"Phase {phase_id}",
                    "PhaseId": phase_id,
                    "Status": "重複" if current_flag else "単独",
                    "Start": segment_start.isoformat(),
                    "End": days[-1].date().isoformat(),
                }
            )
    return pd.DataFrame(rows)


def calculate_overlap_summary(ships, start_month, end_month):
    months = month_range(start_month, end_month)
    rows = []
    for month in months:
        month_start = month.start_time.date()
        month_end = month.end_time.date()
        active_ships = set()
        phase_counts = {1: 0, 2: 0, 3: 0}
        for ship in ships:
            ship_active = False
            for phase in ship.get("phases", []):
                phase_start = pd.to_datetime(phase.get("開始日")).date()
                phase_end = pd.to_datetime(phase.get("終了日")).date()
                if phase_start <= month_end and phase_end >= month_start:
                    ship_active = True
                    phase_counts[phase.get("phase")] += 1
            if ship_active:
                active_ships.add(ship.get("船名"))
        rows.append(
            {
                "month": str(month),
                "active_ships": len(active_ships),
                "phase1": phase_counts[1],
                "phase2": phase_counts[2],
                "phase3": phase_counts[3],
            }
        )
    return pd.DataFrame(rows)


def shift_month(period, offset):
    return period + offset


def prepare_actual_with_lag(actual_df, lag_pattern):
    if actual_df.empty:
        return actual_df.copy()
    df = actual_df.copy()
    if lag_pattern == "A":
        return df
    if lag_pattern == "B":
        df["month"] = df["month"].apply(lambda m: shift_month(m, -1))
        return df
    if lag_pattern == "C":
        df["month"] = df["month"].apply(lambda m: shift_month(m, 1))
        return df
    if lag_pattern == "D":
        expanded = []
        for offset in (-1, 0, 1):
            part = df.copy()
            part["month"] = part["month"].apply(lambda m: shift_month(m, offset))
            part["actual"] = part["actual"] / 3
            expanded.append(part)
        return pd.concat(expanded, ignore_index=True)
    if lag_pattern == "E":
        expanded = []
        for offset in (-2, -3, -4):
            part = df.copy()
            part["month"] = part["month"].apply(lambda m: shift_month(m, offset))
            part["actual"] = part["actual"] / 3
            expanded.append(part)
        return pd.concat(expanded, ignore_index=True)
    return df


def compute_errors(pred_df, actual_df, start_month, end_month):
    months = set(month_range(start_month, end_month))
    pred = pred_df[pred_df["month"].isin(months)]
    actual = actual_df[actual_df["month"].isin(months)]
    if not actual.empty:
        actual = actual.groupby(["month", "material"])["actual"].sum().reset_index()
    merged = pred.merge(actual, on=["month", "material"], how="outer").fillna(0)
    merged["error"] = merged["predicted"] - merged["actual"]
    merged["abs_error"] = merged["error"].abs()
    merged["pct_error"] = merged.apply(
        lambda r: (r["abs_error"] / r["actual"] * 100) if r["actual"] else np.nan,
        axis=1,
    )
    return merged


def compute_stats(merged_df):
    if merged_df.empty:
        return {
            "MAPE": np.nan,
            "RMSE": np.nan,
            "MAE": np.nan,
            "R2": np.nan,
        }
    valid = merged_df.dropna(subset=["pct_error"])
    if valid.empty:
        return {"MAPE": np.nan, "RMSE": np.nan, "MAE": np.nan, "R2": np.nan}
    mape = valid["pct_error"].mean()
    rmse = np.sqrt(np.mean((valid["error"] / valid["actual"]) ** 2)) * 100
    mae = valid["abs_error"].mean()
    actual = valid["actual"]
    predicted = valid["predicted"]
    r2 = np.nan
    if actual.nunique() > 1:
        corr = np.corrcoef(actual, predicted)[0, 1]
        r2 = corr ** 2
    return {"MAPE": mape, "RMSE": rmse, "MAE": mae, "R2": r2}


def calculate_buffer_errors(pred_df, actual_df, start_month, end_month, buffers):
    results = []
    for label, (start_offset, end_offset) in buffers.items():
        buffer_start = shift_month(start_month, start_offset)
        buffer_end = shift_month(end_month, end_offset)
        months = set(month_range(buffer_start, buffer_end))
        actual = actual_df[actual_df["month"].isin(months)]
        actual_totals = actual.groupby("material")["actual"].sum().reset_index()
        pred_totals = (
            pred_df.groupby("material")["predicted"].sum().reset_index()
        )
        merged = pred_totals.merge(actual_totals, on="material", how="outer").fillna(0)
        merged["error_rate"] = merged.apply(
            lambda r: ((r["actual"] - r["predicted"]) / r["predicted"] * 100)
            if r["predicted"]
            else np.nan,
            axis=1,
        )
        merged["buffer"] = label
        results.append(merged)
    return pd.concat(results, ignore_index=True)


def estimate_actual_by_shiptype(pred_df, actual_phase_df):
    if pred_df.empty or actual_phase_df.empty:
        return pd.DataFrame(
            columns=["shipType", "phase", "material", "predicted", "actual", "error_rate"]
        )
    pred_phase = (
        pred_df.groupby(["phase", "material", "shipType"])["predicted"].sum().reset_index()
    )
    phase_totals = (
        pred_phase.groupby(["phase", "material"])["predicted"].sum().reset_index()
    )
    phase_totals = phase_totals.rename(columns={"predicted": "phase_total"})
    pred_phase = pred_phase.merge(phase_totals, on=["phase", "material"], how="left")
    pred_phase["share"] = pred_phase.apply(
        lambda r: r["predicted"] / r["phase_total"] if r["phase_total"] else 0,
        axis=1,
    )
    actual_totals = (
        actual_phase_df.groupby(["phase", "material"])["actual"].sum().reset_index()
    )
    merged = pred_phase.merge(actual_totals, on=["phase", "material"], how="left").fillna(0)
    merged["actual"] = merged["actual"] * merged["share"]
    merged["error_rate"] = merged.apply(
        lambda r: ((r["actual"] - r["predicted"]) / r["predicted"] * 100)
        if r["predicted"]
        else np.nan,
        axis=1,
    )
    return merged[["shipType", "phase", "material", "predicted", "actual", "error_rate"]]


def build_cumulative_curve(pred_daily, actual_monthly, start_month, end_month):
    months = month_range(start_month, end_month)
    period_start = months[0].start_time.date()
    period_end = months[-1].end_time.date()
    dates = pd.date_range(period_start, period_end, freq="D")

    pred_daily = pred_daily.groupby("date")["predicted"].sum().reindex(dates, fill_value=0)

    actual_daily = pd.Series(0.0, index=dates)
    for month in months:
        month_dates = dates[(dates.month == month.month) & (dates.year == month.year)]
        if month_dates.empty:
            continue
        total_actual = actual_monthly[actual_monthly["month"] == month]["actual"].sum()
        actual_daily.loc[month_dates] = total_actual / len(month_dates)

    return pd.DataFrame(
        {
            "date": dates,
            "predicted_cum": pred_daily.cumsum().values,
            "actual_cum": actual_daily.cumsum().values,
        }
    )


def generate_html_report(summary_table, buffer_table, stats_table):
    return f"""
    <html>
    <head><meta charset='utf-8'></head>
    <body>
    <h1>標準データ検証アプリ 2.0 レポート</h1>
    <h2>統計サマリー</h2>
    {stats_table.to_html(index=False)}
    <h2>月別予測 vs 実績</h2>
    {summary_table.to_html(index=False)}
    <h2>バッファ期間別誤差</h2>
    {buffer_table.to_html(index=False)}
    </body>
    </html>
    """


def generate_pdf_report(summary_table, buffer_table, stats_table):
    if FPDF is None:
        return None
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=12)
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    pdf.cell(0, 8, "標準データ検証アプリ 2.0 レポート", ln=1)
    pdf.ln(4)

    def add_table(title, table):
        pdf.set_font("Helvetica", size=11)
        pdf.cell(0, 6, title, ln=1)
        pdf.set_font("Helvetica", size=9)
        for _, row in table.iterrows():
            line = ", ".join(f"{col}: {row[col]}" for col in table.columns)
            pdf.multi_cell(0, 4, line)
        pdf.ln(3)

    add_table("統計サマリー", stats_table)
    add_table("月別予測 vs 実績", summary_table)
    add_table("バッファ期間別誤差", buffer_table)

    return pdf.output(dest="S").encode("latin1")


def main():
    st.set_page_config(page_title="標準データ検証アプリ 2.0", layout="wide")
    st.title("標準データ検証アプリ 2.0 - 全検証方法比較版")

    master_default = load_master()
    holidays = master_default.get("holidays", [])

    with st.sidebar:
        st.header("データ入力")
        ship_files = st.file_uploader("複数船JSON", accept_multiple_files=True, type=["json"])
        materials_phase1 = st.file_uploader("Phase1 材料納入JSON", type=["json"], key="phase1")
        materials_phase2 = st.file_uploader("Phase2 材料納入JSON", type=["json"], key="phase2")
        materials_phase3 = st.file_uploader("Phase3 材料納入JSON", type=["json"], key="phase3")
        master_file = st.file_uploader("マスターデータJSON", type=["json"], key="master")

        st.subheader("検証期間")
        presets = {
            "1年間": ("2021-04", "2022-03"),
            "6ヶ月": ("2021-10", "2022-03"),
            "3ヶ月": ("2022-01", "2022-03"),
            "カスタム": None,
        }
        preset = st.selectbox("プリセット期間", list(presets.keys()))
        if preset != "カスタム":
            start_month, end_month = presets[preset]
        else:
            start_month = st.text_input("開始年月 (YYYY-MM)", "2021-04")
            end_month = st.text_input("終了年月 (YYYY-MM)", "2022-03")

        material_filter = st.multiselect(
            "材料種類フィルター", master_default.get("materialsByPhase", {}).get("phase1", [])
        )

    ships = []
    if ship_files:
        for file in ship_files:
            ships.append(json.load(file))
    else:
        ships = load_default_ships()

    materials_by_phase = load_default_materials()
    if materials_phase1:
        materials_by_phase[1] = json.load(materials_phase1)
    if materials_phase2:
        materials_by_phase[2] = json.load(materials_phase2)
    if materials_phase3:
        materials_by_phase[3] = json.load(materials_phase3)

    master_data = master_default if not master_file else json.load(master_file)
    holidays = master_data.get("holidays", [])

    start_period = parse_month(start_month)
    end_period = parse_month(end_month)

    lag_labels = {
        "A": "同月",
        "B": "前1ヶ月（先行納入）",
        "C": "後1ヶ月（遅延納入）",
        "D": "前後±1ヶ月平均",
        "E": "前2-4ヶ月平均",
    }

    if "coeff_overrides" not in st.session_state:
        st.session_state["coeff_overrides"] = {}
    if "opt_history" not in st.session_state:
        st.session_state["opt_history"] = []
    if "opt_trials" not in st.session_state:
        st.session_state["opt_trials"] = []
    if "opt_stop" not in st.session_state:
        st.session_state["opt_stop"] = False

    master_for_calc = apply_phase_coefficients(master_data, st.session_state["coeff_overrides"])
    pred_df = calculate_predicted_monthly(ships, master_for_calc, holidays, start_period, end_period)
    actual_df = extract_materials_records(materials_by_phase)

    if material_filter:
        pred_df = pred_df[pred_df["material"].isin(material_filter)]
        actual_df = actual_df[actual_df["material"].isin(material_filter)]

    tabs = st.tabs(
        [
            "概要",
            "タイムライン",
            "月別検証",
            "累積検証",
            "船種・Phase",
            "S-curve",
            "総合評価",
            "係数最適化",
        ]
    )

    with tabs[0]:
        st.subheader("データ読み込み状況")
        st.write(f"船データ: {len(ships)}件")
        st.write(f"予測レコード: {len(pred_df)}件")
        st.write(f"実績レコード: {len(actual_df)}件")

    with tabs[1]:
        st.subheader("タイムライン可視化")
        timeline_df = build_timeline_df(ships)
        if not timeline_df.empty:
            fig = px.timeline(
                timeline_df,
                x_start="Start",
                x_end="End",
                y="Ship",
                color="PhaseId",
                color_discrete_map=PHASE_COLORS,
                pattern_shape="Status",
                pattern_shape_map={"単独": "", "重複": "/"},
                hover_data={"Phase": True, "PhaseId": True, "Status": True},
            )
            fig.update_yaxes(autorange="reversed")
            st.plotly_chart(fig, use_container_width=True)
        overlap_df = calculate_overlap_summary(ships, start_period, end_period)
        st.subheader("月別稼働船数")
        if not overlap_df.empty:
            bar = px.bar(
                overlap_df,
                x="month",
                y="active_ships",
                title="月別稼働船数",
            )
            st.plotly_chart(bar, use_container_width=True)
            st.subheader("重複期間サマリー")
            st.dataframe(overlap_df, use_container_width=True)

    with tabs[2]:
        st.subheader("月別予測 vs 実績")
        lag_label = st.selectbox("タイムラグパターン", list(lag_labels.values()))
        lag_pattern = {v: k for k, v in lag_labels.items()}[lag_label]
        actual_shifted = prepare_actual_with_lag(actual_df, lag_pattern)
        material_options = sorted(
            set(pred_df["material"].unique()).union(actual_shifted["material"].unique())
        )
        phase_options = sorted(
            set(pred_df["phase"].unique()).union(actual_shifted["phase"].unique())
        )
        month_options = sorted(
            set(pred_df["month"].astype(str).unique()).union(
                actual_shifted["month"].astype(str).unique()
            )
        )
        material_sel = st.selectbox("材料", ["(全て)"] + material_options)
        phase_sel = st.selectbox("Phase", ["(全て)"] + [str(p) for p in phase_options])
        month_sel = st.selectbox("月", ["(全て)"] + month_options)

        filtered_pred = pred_df.copy()
        filtered_actual = actual_shifted.copy()
        if material_sel != "(全て)":
            filtered_pred = filtered_pred[filtered_pred["material"] == material_sel]
            filtered_actual = filtered_actual[filtered_actual["material"] == material_sel]
        if phase_sel != "(全て)":
            phase_value = int(phase_sel)
            filtered_pred = filtered_pred[filtered_pred["phase"] == phase_value]
            filtered_actual = filtered_actual[filtered_actual["phase"] == phase_value]

        pred_monthly = (
            filtered_pred.groupby(["month", "material"])["predicted"].sum().reset_index()
        )
        merged = compute_errors(pred_monthly, filtered_actual, start_period, end_period)
        if month_sel != "(全て)":
            merged = merged[merged["month"].astype(str) == month_sel]
        with st.expander("デバッグ: 計算式", expanded=False):
            st.code(
                "\n".join(
                    [
                        "予測（日次）= baseAmount × coefficient × S-curve_resampled[day_index]",
                        "S-curve_resampled = S-curveを実工期の営業日数に合わせて補間し、合計1に正規化",
                        "営業日 = 土日＋祝日(holidays)を除外",
                        "予測（月次）= 対象月の営業日分の予測（日次）を合計",
                        "実績（月次）= 材料納入JSONの月次合計",
                        "誤差率(%) = |予測-実績| / 実績 × 100（実績0はNaN）",
                        "タイムラグ A: 同月 / B: 1ヶ月先行 / C: 1ヶ月遅延 / D: 前後±1ヶ月平均",
                    ]
                ),
                language="text",
            )
        merged_plot = merged.copy()
        merged_plot["month_dt"] = merged_plot["month"].dt.to_timestamp()
        merged_plot = merged_plot.sort_values("month_dt")
        if not merged.empty:
            line = px.line(
                merged_plot,
                x="month_dt",
                y="predicted",
                color="material",
                title="予測使用量",
            )
            st.plotly_chart(line, use_container_width=True)
            line_actual = px.line(
                merged_plot,
                x="month_dt",
                y="actual",
                color="material",
                title="実績納入量",
                markers=True,
            )
            st.plotly_chart(line_actual, use_container_width=True)
            err_line = px.line(
                merged_plot,
                x="month_dt",
                y="pct_error",
                color="material",
                title="誤差率（%）",
            )
            st.plotly_chart(err_line, use_container_width=True)
        st.dataframe(merged, use_container_width=True)
        st.subheader("合計（現在の表）")
        if merged.empty:
            st.write("該当データなし")
        else:
            total_pred = merged["predicted"].sum()
            total_actual = merged["actual"].sum()
            total_error = merged["error"].sum()
            total_abs_error = merged["abs_error"].sum()
            total_pct_error = (
                (total_abs_error / total_actual) * 100 if total_actual else np.nan
            )
            summary_df = pd.DataFrame(
                [
                    {
                        "predicted_total": total_pred,
                        "actual_total": total_actual,
                        "error_total": total_error,
                        "abs_error_total": total_abs_error,
                        "pct_error_total": total_pct_error,
                    }
                ]
            )
            st.dataframe(summary_df, use_container_width=True)

    with tabs[3]:
        st.subheader("期間累積検証")
        pred_totals = pred_df.groupby("material")["predicted"].sum().reset_index()
        buffers = {
            "バッファ0ヶ月": (0, 0),
            "バッファ前1ヶ月": (-1, -1),
            "バッファ後1ヶ月": (1, 1),
            "バッファ前後1ヶ月": (-1, 1),
            "バッファ前2ヶ月": (-2, -2),
            "バッファ後2ヶ月": (2, 2),
        }
        buffer_df = calculate_buffer_errors(pred_df, actual_df, start_period, end_period, buffers)
        st.dataframe(buffer_df, use_container_width=True)
        if not buffer_df.empty:
            fig = px.bar(
                buffer_df,
                x="buffer",
                y="error_rate",
                color="material",
                barmode="group",
                title="バッファ期間別誤差率",
            )
            st.plotly_chart(fig, use_container_width=True)

    with tabs[4]:
        st.subheader("船種・Phase別の精度分析")
        st.caption("実績はPhase合計から予測比率で按分した推定値")
        actual_phase_df = actual_df.groupby(["phase", "month", "material"])["actual"].sum().reset_index()
        shiptype_df = estimate_actual_by_shiptype(pred_df, actual_phase_df)
        st.dataframe(shiptype_df, use_container_width=True)
        if not shiptype_df.empty:
            heat = px.density_heatmap(
                shiptype_df,
                x="shipType",
                y="material",
                z="error_rate",
                facet_col="phase",
                color_continuous_scale="RdBu",
                title="船種×Phase×材料の誤差率ヒートマップ",
            )
            st.plotly_chart(heat, use_container_width=True)

    with tabs[5]:
        st.subheader("S-curve検証")
        pred_daily = pred_df.copy()
        if not pred_daily.empty:
            pred_daily["date"] = pred_daily["month"].dt.to_timestamp() + pd.to_timedelta(15, unit="D")
        lag_candidates = {}
        for pattern in lag_labels.keys():
            shifted = prepare_actual_with_lag(actual_df, pattern)
            merged = compute_errors(
                pred_df.groupby(["month", "material"])["predicted"].sum().reset_index(),
                shifted,
                start_period,
                end_period,
            )
            stats = compute_stats(merged)
            lag_candidates[pattern] = stats
        best_pattern = min(
            lag_candidates.items(),
            key=lambda x: x[1]["MAPE"] if not np.isnan(x[1]["MAPE"]) else np.inf,
        )[0]
        actual_best = prepare_actual_with_lag(actual_df, best_pattern)
        curve = build_cumulative_curve(pred_daily, actual_best, start_period, end_period)
        curve_fig = go.Figure()
        curve_fig.add_trace(go.Scatter(x=curve["date"], y=curve["predicted_cum"], name="予測累積"))
        curve_fig.add_trace(go.Scatter(x=curve["date"], y=curve["actual_cum"], name="実績累積"))
        st.plotly_chart(curve_fig, use_container_width=True)
        st.write(f"最適タイムラグパターン: {lag_labels.get(best_pattern, best_pattern)}")

    with tabs[6]:
        st.subheader("統計サマリー & 総合評価")
        stats_rows = []
        for pattern in lag_labels.keys():
            shifted = prepare_actual_with_lag(actual_df, pattern)
            merged = compute_errors(
                pred_df.groupby(["month", "material"])["predicted"].sum().reset_index(),
                shifted,
                start_period,
                end_period,
            )
            stats = compute_stats(merged)
            stats_rows.append({"pattern": pattern, **stats})
        stats_df = pd.DataFrame(stats_rows)
        st.dataframe(stats_df, use_container_width=True)
        best_pattern = stats_df.sort_values("MAPE").iloc[0]["pattern"] if not stats_df.empty else "A"
        st.write(
            f"推奨される検証方法（最小MAPE）: {lag_labels.get(best_pattern, best_pattern)}"
        )

        pred_monthly = pred_df.groupby(["month", "material"])["predicted"].sum().reset_index()
        merged = compute_errors(pred_monthly, prepare_actual_with_lag(actual_df, best_pattern), start_period, end_period)

        st.subheader("CSVエクスポート")
        st.download_button(
            "月別予測vs実績.csv",
            pred_monthly.merge(actual_df, on=["month", "material"], how="outer").to_csv(index=False),
            file_name="monthly_prediction_vs_actual.csv",
        )
        st.download_button(
            "累積検証結果.csv",
            buffer_df.to_csv(index=False),
            file_name="buffer_analysis.csv",
        )
        st.download_button(
            "船種別精度.csv",
            shiptype_df.to_csv(index=False),
            file_name="shiptype_accuracy.csv",
        )
        st.download_button(
            "統計サマリー.csv",
            stats_df.to_csv(index=False),
            file_name="stats_summary.csv",
        )

        st.subheader("レポート出力")
        html_report = generate_html_report(
            merged.head(50),
            buffer_df.head(50),
            stats_df,
        )
        st.download_button(
            "レポートHTML",
            html_report,
            file_name="report.html",
        )
        pdf_bytes = generate_pdf_report(
            merged.head(50),
            buffer_df.head(50),
            stats_df,
        )
        if pdf_bytes is None:
            st.warning("PDF生成には fpdf2 のインストールが必要です。")
        else:
            st.download_button(
                "レポートPDF",
                pdf_bytes,
                file_name="report.pdf",
            )

    with tabs[7]:
        st.subheader("係数最適化")
        st.caption("3船種×3フェーズの係数を自動調整してMAPE/実数誤差を改善します。")

        ship_types = [s.get("id") for s in master_data.get("shipTypes", [])]
        phase_ids = [1, 2, 3]
        coeff_keys = [(s, p) for s in ship_types for p in phase_ids]

        st.markdown("### 設定")
        target_ship_types = st.multiselect(
            "対象船種", ship_types, default=ship_types
        )
        target_phases = st.multiselect(
            "対象フェーズ", phase_ids, default=phase_ids
        )
        fixed_keys = st.multiselect(
            "固定する係数（最適化対象から除外）",
            [f"{s}-Phase{p}" for s, p in coeff_keys],
            default=[],
        )

        objective = st.selectbox(
            "目的関数",
            ["MAPE最小化", "実数誤差最小化", "バランス型", "カスタム"],
        )
        weight_mape = 0.5
        if objective in ("バランス型", "カスタム"):
            weight_mape = st.slider("MAPEの重み", 0.0, 1.0, 0.5, 0.05)

        coeff_min = st.number_input("係数の下限", value=0.5, step=0.1)
        coeff_max = st.number_input("係数の上限", value=2.0, step=0.1)
        corr_min = st.number_input("相関係数の最低値", value=0.8, step=0.05)
        max_delta = st.number_input("係数変化率上限（±）", value=0.5, step=0.1)

        algorithm = st.selectbox(
            "最適化アルゴリズム",
            ["勾配降下法", "遺伝的アルゴリズム", "ベイズ最適化", "グリッドサーチ"],
        )
        lag_label = st.selectbox("最適化時のタイムラグ", list(lag_labels.values()))
        lag_pattern = {v: k for k, v in lag_labels.items()}[lag_label]

        max_trials = st.number_input("最大試行回数", value=100, step=10)
        timeout_sec = st.number_input("タイムアウト(秒)", value=120, step=10)

        st.markdown("### 実行")
        col_run, col_pause, col_stop, col_reset = st.columns(4)
        if col_run.button("最適化開始"):
            st.session_state["opt_stop"] = False
            st.session_state["opt_trials"] = []

            target_keys = [
                (s, p)
                for s in target_ship_types
                for p in target_phases
                if f"{s}-Phase{p}" not in fixed_keys
            ]
            base_coeffs = {(s, p): 1.0 for s, p in coeff_keys}

            progress = st.progress(0)
            status = st.empty()
            best_score = np.inf
            best_coeffs = {}
            best_metrics = {}
            start_time = datetime.now()

            for idx in range(int(max_trials)):
                elapsed = (datetime.now() - start_time).total_seconds()
                if elapsed > timeout_sec or st.session_state["opt_stop"]:
                    break

                if algorithm == "グリッドサーチ":
                    steps = max(2, int(np.sqrt(max_trials)))
                    grid = generate_coeff_grid(coeff_min, coeff_max, steps)
                    coeffs = {}
                    for key in target_keys:
                        coeffs[key] = np.random.choice(grid)
                else:
                    coeffs = random_coefficients(target_keys, coeff_min, coeff_max, base_coeffs, max_delta)

                applied = apply_phase_coefficients(master_data, coeffs)
                pred_train = calculate_predicted_monthly(
                    ships, applied, holidays, parse_month("2021-04"), parse_month("2022-01")
                )
                actual_shifted = prepare_actual_with_lag(actual_df, lag_pattern)
                stats, abs_error_sum = evaluate_prediction_metrics(
                    pred_train, actual_shifted, parse_month("2021-04"), parse_month("2022-01")
                )

                r2 = stats.get("R2")
                mape = stats.get("MAPE")
                if r2 is not None and not np.isnan(r2) and r2 < corr_min:
                    score = np.inf
                else:
                    if objective == "MAPE最小化":
                        score = mape
                    elif objective == "実数誤差最小化":
                        score = abs_error_sum
                    else:
                        score = (weight_mape * mape) + ((1 - weight_mape) * abs_error_sum)

                st.session_state["opt_trials"].append(
                    {
                        "trial": idx + 1,
                        "score": score,
                        "MAPE": mape,
                        "abs_error": abs_error_sum,
                        "R2": r2,
                    }
                )

                if score is not None and score < best_score:
                    best_score = score
                    best_coeffs = coeffs
                    best_metrics = {"MAPE": mape, "abs_error": abs_error_sum, "R2": r2}

                progress.progress(min((idx + 1) / max_trials, 1.0))
                avg_time = elapsed / (idx + 1)
                eta = max_trials - (idx + 1)
                eta_sec = int(avg_time * eta)
                status.write(
                    f"試行 {idx + 1}/{max_trials} | 最良スコア: {best_score:.4f} | 経過 {int(elapsed)}秒 | 残り目安 {eta_sec}秒"
                )

            st.session_state["opt_history"].append(
                {"timestamp": datetime.now().isoformat(), "best_coeffs": best_coeffs, "metrics": best_metrics}
            )
            st.session_state["best_coeffs"] = best_coeffs
            st.session_state["best_metrics"] = best_metrics

        if col_pause.button("一時停止"):
            st.session_state["opt_stop"] = True

        if col_stop.button("停止"):
            st.session_state["opt_stop"] = True

        if col_reset.button("リセット"):
            st.session_state["opt_trials"] = []
            st.session_state["best_coeffs"] = {}
            st.session_state["best_metrics"] = {}

        st.markdown("### ログ")
        if st.session_state["opt_trials"]:
            st.dataframe(pd.DataFrame(st.session_state["opt_trials"]), use_container_width=True)
            st.download_button(
                "ログCSV",
                pd.DataFrame(st.session_state["opt_trials"]).to_csv(index=False),
                file_name="optimization_log.csv",
            )
        else:
            st.write("ログなし")

        st.markdown("### 履歴")
        if st.session_state["opt_history"]:
            history_rows = [
                {
                    "timestamp": h["timestamp"],
                    "MAPE": h.get("metrics", {}).get("MAPE"),
                    "abs_error": h.get("metrics", {}).get("abs_error"),
                    "R2": h.get("metrics", {}).get("R2"),
                }
                for h in st.session_state["opt_history"]
            ]
            st.dataframe(pd.DataFrame(history_rows), use_container_width=True)
        else:
            st.write("履歴なし")

        st.markdown("### 結果表示")
        best_coeffs = st.session_state.get("best_coeffs", {})
        if best_coeffs:
            train_start = parse_month("2021-04")
            train_end = parse_month("2022-01")
            test_start = parse_month("2022-02")
            test_end = parse_month("2022-03")
            actual_shifted = prepare_actual_with_lag(actual_df, lag_pattern)

            rows = []
            for ship_id in ship_types:
                for phase_id in phase_ids:
                    before = 1.0
                    after = best_coeffs.get((ship_id, phase_id), 1.0)
                    rows.append(
                        {
                            "shipType": ship_id,
                            "phase": phase_id,
                            "before": before,
                            "after": after,
                            "change_pct": ((after / before) - 1) * 100 if before else np.nan,
                        }
                    )
            coeff_table = pd.DataFrame(rows)
            st.dataframe(coeff_table, use_container_width=True)

            pivot = coeff_table.pivot(index="shipType", columns="phase", values="change_pct")
            heat_fig = px.imshow(
                pivot,
                text_auto=True,
                color_continuous_scale="RdBu",
                title="船種×フェーズ 係数変化率（%）",
            )
            st.plotly_chart(heat_fig, use_container_width=True)

            base_pred = calculate_predicted_monthly(
                ships, master_data, holidays, train_start, train_end
            )
            opt_master = apply_phase_coefficients(master_data, best_coeffs)
            opt_pred = calculate_predicted_monthly(
                ships, opt_master, holidays, train_start, train_end
            )
            base_stats, base_abs = evaluate_prediction_metrics(
                base_pred, actual_shifted, train_start, train_end
            )
            opt_stats, opt_abs = evaluate_prediction_metrics(
                opt_pred, actual_shifted, train_start, train_end
            )
            summary = pd.DataFrame(
                [
                    {
                        "phase": "train",
                        "mape_before": base_stats.get("MAPE"),
                        "mape_after": opt_stats.get("MAPE"),
                        "abs_before": base_abs,
                        "abs_after": opt_abs,
                        "r2_before": base_stats.get("R2"),
                        "r2_after": opt_stats.get("R2"),
                    }
                ]
            )
            st.subheader("精度改善サマリー（学習期間）")
            st.dataframe(summary, use_container_width=True)

            test_base_pred = calculate_predicted_monthly(
                ships, master_data, holidays, test_start, test_end
            )
            test_opt_pred = calculate_predicted_monthly(
                ships, opt_master, holidays, test_start, test_end
            )
            test_base_stats, test_base_abs = evaluate_prediction_metrics(
                test_base_pred, actual_shifted, test_start, test_end
            )
            test_opt_stats, test_opt_abs = evaluate_prediction_metrics(
                test_opt_pred, actual_shifted, test_start, test_end
            )
            test_summary = pd.DataFrame(
                [
                    {
                        "phase": "test",
                        "mape_before": test_base_stats.get("MAPE"),
                        "mape_after": test_opt_stats.get("MAPE"),
                        "abs_before": test_base_abs,
                        "abs_after": test_opt_abs,
                        "r2_before": test_base_stats.get("R2"),
                        "r2_after": test_opt_stats.get("R2"),
                    }
                ]
            )
            st.subheader("精度改善サマリー（テスト期間）")
            st.dataframe(test_summary, use_container_width=True)

            st.subheader("月別予測 vs 実績（最適化前後）")
            base_monthly = (
                base_pred.groupby("month")["predicted"].sum().reset_index()
            )
            opt_monthly = (
                opt_pred.groupby("month")["predicted"].sum().reset_index()
            )
            actual_monthly = (
                actual_shifted.groupby("month")["actual"].sum().reset_index()
            )
            merged_monthly = base_monthly.merge(opt_monthly, on="month", suffixes=("_before", "_after"))
            merged_monthly = merged_monthly.merge(actual_monthly, on="month", how="left")
            merged_monthly["month_dt"] = merged_monthly["month"].dt.to_timestamp()
            merged_monthly = merged_monthly.sort_values("month_dt")

            comp_fig = go.Figure()
            comp_fig.add_trace(
                go.Scatter(
                    x=merged_monthly["month_dt"],
                    y=merged_monthly["predicted_before"],
                    name="予測（最適化前）",
                    line=dict(dash="dot"),
                )
            )
            comp_fig.add_trace(
                go.Scatter(
                    x=merged_monthly["month_dt"],
                    y=merged_monthly["predicted_after"],
                    name="予測（最適化後）",
                    line=dict(),
                )
            )
            comp_fig.add_trace(
                go.Scatter(
                    x=merged_monthly["month_dt"],
                    y=merged_monthly["actual"],
                    name="実績",
                    mode="markers",
                )
            )
            st.plotly_chart(comp_fig, use_container_width=True)

            merged_monthly["error_after"] = merged_monthly["predicted_after"] - merged_monthly["actual"]
            err_fig = px.bar(
                merged_monthly,
                x="month_dt",
                y="error_after",
                title="月別誤差（最適化後）",
            )
            st.plotly_chart(err_fig, use_container_width=True)

            st.download_button(
                "係数テーブルCSV",
                coeff_table.to_csv(index=False),
                file_name="optimized_coefficients.csv",
            )

            col_apply, col_export = st.columns(2)
            if col_apply.button("この係数でシミュレーション"):
                st.session_state["coeff_overrides"] = best_coeffs
                if hasattr(st, "rerun"):
                    st.rerun()
                else:
                    st.experimental_rerun()
            updated_master = apply_phase_coefficients(master_data, best_coeffs)
            col_export.download_button(
                "マスターデータにエクスポート",
                json.dumps(updated_master, ensure_ascii=False, indent=2),
                file_name="master_data_optimized.json",
            )
        else:
            st.write("最適化結果なし")


if __name__ == "__main__":
    main()
