from __future__ import annotations

import math
from pathlib import Path
import subprocess
import sys
from typing import Iterable

import folium
import streamlit as st
from streamlit_folium import st_folium
import yaml

from batch.storage import connect, get_agg_for_year, get_available_years, get_latest_run_id, init_db
from batch.query_builder import Department, University


CONFIG_DIR = Path("config")


def _load_yaml(path: Path) -> list[dict]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"Expected list in {path}")
    return data


def load_departments() -> list[Department]:
    items = _load_yaml(CONFIG_DIR / "departments.yaml")
    return [
        Department(
            id=item["id"],
            label_ja=item["label_ja"],
            label_en=item["label_en"],
            aff_patterns=item.get("aff_patterns", []),
            aff_exclude_patterns=item.get("aff_exclude_patterns", []),
            mesh_terms=item.get("mesh_terms", []),
        )
        for item in items
    ]


def load_universities() -> list[University]:
    items = _load_yaml(CONFIG_DIR / "universities.yaml")
    return [
        University(
            id=item["id"],
            name_ja=item["name_ja"],
            name_en=item["name_en"],
            lat=float(item["lat"]),
            lon=float(item["lon"]),
            aff_patterns=item.get("aff_patterns", []),
            aff_exclude_patterns=item.get("aff_exclude_patterns", []),
        )
        for item in items
    ]


def _radius_from_total(
    total_if: float,
    global_min: float,
    global_max: float,
    min_radius: float = 3.0,
    max_radius: float = 50.0,
) -> float:
    if total_if <= 0:
        return 0.0
    if global_max <= global_min:
        return (min_radius + max_radius) / 2
    sqrt_value = math.sqrt(total_if)
    sqrt_min = math.sqrt(global_min)
    sqrt_max = math.sqrt(global_max)
    normalized = (sqrt_value - sqrt_min) / (sqrt_max - sqrt_min)
    return min_radius + normalized * (max_radius - min_radius)


def _build_display_rows(
    universities: list[University],
    agg_rows: dict[str, object],
    year: int,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for university in universities:
        row = agg_rows.get(university.id)
        if row:
            paper_count = int(row["paper_count"])
            total_if = float(row["total_if"])
        else:
            paper_count = 0
            total_if = 0.0
        rows.append(
            {
                "year": year,
                "university_id": university.id,
                "name_ja": university.name_ja,
                "name_en": university.name_en,
                "lat": university.lat,
                "lon": university.lon,
                "paper_count": paper_count,
                "total_if": total_if,
            }
        )
    return rows


def _add_university_markers(
    map_obj: folium.Map,
    universities: list[University],
    agg_rows: dict[str, object],
    year: int,
    if_policy: str,
    global_min: float,
    global_max: float,
) -> None:
    for university in universities:
        row = agg_rows.get(university.id)
        if row:
            paper_count = int(row["paper_count"])
            total_if = float(row["total_if"])
        else:
            paper_count = 0
            total_if = 0.0

        radius = _radius_from_total(total_if, global_min, global_max)
        if radius <= 0:
            continue

        tooltip = (
            f"{university.name_ja} ({university.name_en})\n"
            f"Year: {year}\n"
            f"paper_count: {paper_count}\n"
            f"total_if: {total_if:.1f}\n"
            f"if_policy: {if_policy}"
        )
        folium.CircleMarker(
            location=[university.lat, university.lon],
            radius=radius,
            color="#1f77b4",
            fill=True,
            fill_color="#1f77b4",
            fill_opacity=0.7,
            tooltip=tooltip,
        ).add_to(map_obj)


def _format_multiselect_label(options: Iterable[dict], label_key: str) -> dict:
    return {item["id"]: item[label_key] for item in options}


def run_batch_from_ui(
    start_year: int,
    end_year: int,
    universities: list[str],
    departments: list[str],
    api_key: str | None,
    force: bool,
    log_placeholder: st.delta_generator.DeltaGenerator | None = None,
) -> tuple[bool, list[str]]:
    cmd = [
        sys.executable,
        "-m",
        "batch.run",
        "--start-year",
        str(start_year),
        "--end-year",
        str(end_year),
        "--universities",
        ",".join(universities),
        "--departments",
        ",".join(departments),
    ]
    if api_key:
        cmd.extend(["--api-key", api_key])
    if force:
        cmd.append("--force")

    output_lines: list[str] = []
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    if process.stdout:
        for line in process.stdout:
            output_lines.append(line.rstrip())
            if log_placeholder:
                log_placeholder.text("\n".join(output_lines))
    return_code = process.wait()
    return return_code == 0, output_lines


def show_data_management(universities: list[University], departments: list[Department]) -> None:
    st.title("📊 データ管理")

    conn = connect()
    init_db(conn)
    run_row = conn.execute(
        "SELECT run_id, computed_at FROM runs ORDER BY computed_at DESC LIMIT 1"
    ).fetchone()
    if not run_row:
        st.warning("⚠️ まだデータが取得されていません。下記のバッチ実行で取得してください。")
    else:
        run_id = run_row["run_id"]
        st.caption(f"最新run_id: {run_id} / computed_at: {run_row['computed_at']}")

        rows = conn.execute(
            """
            SELECT
                university_id,
                department_id,
                COUNT(DISTINCT year) AS year_count,
                MIN(year) AS min_year,
                MAX(year) AS max_year,
                SUM(paper_count) AS total_papers
            FROM agg_year_univ_dept
            WHERE run_id = ?
            GROUP BY university_id, department_id
            ORDER BY university_id, department_id
            """,
            (run_id,),
        ).fetchall()

        univ_name_map = {u.id: u.name_ja for u in universities}
        dept_name_map = {d.id: d.label_ja for d in departments}

        coverage_rows = [
            {
                "大学": univ_name_map.get(row["university_id"], row["university_id"]),
                "診療科": dept_name_map.get(row["department_id"], row["department_id"]),
                "年数": int(row["year_count"]),
                "期間": f"{int(row['min_year'])} - {int(row['max_year'])}",
                "論文数": int(row["total_papers"] or 0),
            }
            for row in rows
        ]

        if coverage_rows:
            st.dataframe(coverage_rows, use_container_width=True)
        else:
            st.info("最新run_idにはデータがありません。")

    st.markdown("---")
    st.markdown("### 🚀 バッチ実行")
    st.warning("⚠️ 開発中の機能です。実行中はUIがブロックされます（数分間）。")

    col1, col2 = st.columns(2)
    with col1:
        batch_start_year = st.number_input("開始年", min_value=2000, max_value=2025, value=2020)
    with col2:
        batch_end_year = st.number_input("終了年", min_value=2000, max_value=2025, value=2025)

    available_universities = [{"id": u.id, "name_ja": u.name_ja} for u in universities]
    university_name_map = _format_multiselect_label(available_universities, "name_ja")
    batch_universities = st.multiselect(
        "対象大学",
        options=[u["id"] for u in available_universities],
        default=[u["id"] for u in available_universities[:1]],
        format_func=lambda x: university_name_map.get(x, x),
        help="テスト実行では1-2校を推奨",
    )

    available_departments = [{"id": d.id, "label_ja": d.label_ja} for d in departments]
    department_name_map = _format_multiselect_label(available_departments, "label_ja")
    batch_departments = st.multiselect(
        "対象診療科",
        options=[d["id"] for d in available_departments],
        default=[d["id"] for d in available_departments[:1]],
        format_func=lambda x: department_name_map.get(x, x),
        help="テスト実行では1診療科を推奨",
    )

    api_key = st.text_input(
        "PubMed API Key（オプション）",
        type="password",
        help="API Keyを設定するとレート制限が緩和されます（10req/s）",
    )

    force_rerun = st.checkbox(
        "既存データを上書き（--force）",
        value=False,
        help="既に取得済みのデータも再取得します",
    )

    log_placeholder = st.empty()

    if st.button("🚀 バッチ実行", type="primary"):
        if not batch_universities or not batch_departments:
            st.error("❌ 大学と診療科を最低1つずつ選択してください")
        else:
            with st.spinner("バッチ実行中..."):
                success, logs = run_batch_from_ui(
                    start_year=int(batch_start_year),
                    end_year=int(batch_end_year),
                    universities=batch_universities,
                    departments=batch_departments,
                    api_key=api_key if api_key else None,
                    force=force_rerun,
                    log_placeholder=log_placeholder,
                )
                if success:
                    st.success("✅ バッチ実行が完了しました")
                    st.balloons()
                    st.rerun()
                else:
                    st.error("❌ バッチ実行がエラーで終了しました。ログを確認してください。")


def show_map_page(universities: list[University], departments: list[Department]) -> None:
    st.title("Neurology Papers (IF=1.0) by University")
    conn = connect()
    init_db(conn)
    run_id = get_latest_run_id(conn)

    if not run_id:
        st.warning("No aggregated data found. Run the batch first.")
        return

    years = get_available_years(conn, run_id)
    if not years:
        st.warning("No year data found in the database.")
        return

    selected_year = st.slider("Year", min_value=min(years), max_value=max(years), value=max(years))

    available_universities = [{"id": u.id, "name_ja": u.name_ja} for u in universities]
    default_universities = ["utokyo", "juntendo", "kyoto", "kyushu", "hokudai"]
    university_name_map = {u["id"]: u["name_ja"] for u in available_universities}
    selected_university_ids = st.multiselect(
        "表示する大学を選択（最大5校）",
        options=[u["id"] for u in available_universities],
        default=default_universities,
        format_func=lambda x: university_name_map.get(x, x),
    )
    if len(selected_university_ids) > 5:
        st.warning("⚠️ 最大5校まで選択できます。最初の5校のみ表示します。")
        selected_university_ids = selected_university_ids[:5]
    if not selected_university_ids:
        st.error("⚠️ 少なくとも1校を選択してください")
        st.stop()
    selected_university_set = set(selected_university_ids)
    selected_universities = [u for u in universities if u.id in selected_university_set]

    available_departments = [{"id": d.id, "label_ja": d.label_ja} for d in departments]
    department_name_map = {d["id"]: d["label_ja"] for d in available_departments}
    selected_department_id = st.selectbox(
        "診療科を選択",
        options=[d["id"] for d in available_departments],
        index=0,
        format_func=lambda x: department_name_map.get(x, x),
    )
    selected_department = next(d for d in departments if d.id == selected_department_id)

    agg_rows = get_agg_for_year(conn, run_id, selected_year, selected_department.id)
    if not any(univ_id in agg_rows for univ_id in selected_university_ids):
        st.warning(f"選択された大学のデータが{selected_year}年には存在しません")
        st.stop()
    df_filtered = _build_display_rows(selected_universities, agg_rows, selected_year)
    row = conn.execute(
        """
        SELECT MIN(total_if) as global_min, MAX(total_if) as global_max
        FROM agg_year_univ_dept
        WHERE run_id = ? AND total_if > 0
        """,
        (run_id,),
    ).fetchone()
    if row and row["global_min"] is not None and row["global_max"] is not None:
        global_min = float(row["global_min"])
        global_max = float(row["global_max"])
    else:
        totals = [float(row["total_if"]) for row in df_filtered if float(row["total_if"]) > 0]
        global_min = min(totals) if totals else 0.0
        global_max = max(totals) if totals else 0.0
    if_policy = "1.0 fixed (temporary)"

    japan_map = folium.Map(
        location=[36.2048, 138.2529],
        zoom_start=5,
        zoom_control=False,
        dragging=False,
        scrollWheelZoom=False,
        doubleClickZoom=False,
        touchZoom=False,
    )
    _add_university_markers(
        japan_map,
        selected_universities,
        agg_rows,
        selected_year,
        if_policy,
        global_min,
        global_max,
    )

    tokyo_area_universities = {"utokyo", "juntendo", "keio", "jikei", "tokyomedical", "showa"}
    tokyo_university_ids = [u for u in selected_university_ids if u in tokyo_area_universities]

    if tokyo_university_ids:
        tokyo_universities = [u for u in selected_universities if u.id in tokyo_university_ids]
        tokyo_map = folium.Map(
            location=[35.7, 139.7],
            zoom_start=10,
            zoom_control=False,
            dragging=False,
            scrollWheelZoom=False,
            doubleClickZoom=False,
            touchZoom=False,
        )
        _add_university_markers(
            tokyo_map,
            tokyo_universities,
            agg_rows,
            selected_year,
            if_policy,
            global_min,
            global_max,
        )

        col1, col2 = st.columns(2)
        with col1:
            st.markdown("### 全国地図")
            st_folium(japan_map, width=700, height=500)
        with col2:
            st.markdown("### 東京圏拡大")
            st_folium(tokyo_map, width=700, height=500)
    else:
        st.markdown("### 全国地図")
        st_folium(japan_map, width=900, height=500)

    st.markdown("---")
    st.markdown("### デバッグ情報")
    st.write(f"**全期間のtotal_if範囲**: {global_min:.1f} 〜 {global_max:.1f}")
    if global_min > 0 and global_max > 0:
        st.write(
            f"**平方根変換後の範囲**: {math.sqrt(global_min):.2f} 〜 {math.sqrt(global_max):.2f}"
        )
    st.write("**円サイズ範囲**: 3〜50ピクセル")
    st.markdown("### 診療科情報")
    st.write(f"**ID**: {selected_department.id}")
    st.write(f"**日本語名**: {selected_department.label_ja}")
    st.write(f"**Affiliationパターン**: {', '.join(selected_department.aff_patterns)}")
    st.write(f"**MeSHターム**: {', '.join(selected_department.mesh_terms)}")
    st.write("**取得データ**:")
    st.dataframe(df_filtered)


def main() -> None:
    st.set_page_config(page_title="Neurology IF Map", layout="wide")

    departments = load_departments()
    universities = load_universities()

    page = st.sidebar.radio("ページ選択", ["📍 地図", "📊 データ管理"], horizontal=False)
    if page == "📊 データ管理":
        show_data_management(universities, departments)
    else:
        show_map_page(universities, departments)


if __name__ == "__main__":
    main()
