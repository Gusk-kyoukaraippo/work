#!/usr/bin/env python3
import html
import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "db" / "arbos_analysis.sqlite3"
OUT_DIR = ROOT / "reports" / "outputs" / "utilization_strategy_20260609"
OUT_HTML = OUT_DIR / "arbos_utilization_strategy_report.html"
OUT_JSON = OUT_DIR / "arbos_utilization_strategy_metrics.json"


COLORS = {
    "long": "#2F5D8C",
    "short": "#D9822B",
    "unknown": "#B8BDC7",
    "green": "#2E7D62",
    "red": "#B85C5C",
    "ink": "#1E2530",
    "muted": "#6B7280",
    "grid": "#E5E7EB",
    "bg": "#F7F8FA",
}


def rows(conn, sql, params=()):
    conn.row_factory = sqlite3.Row
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def one(conn, sql, params=()):
    conn.row_factory = sqlite3.Row
    r = conn.execute(sql, params).fetchone()
    return dict(r) if r else {}


def pct(n, d):
    return None if not d else 100.0 * n / d


def fmt_pct(v, digits=1):
    return "NA" if v is None else f"{v:.{digits}f}%"


def fmt_num(v, digits=0):
    if v is None:
        return "NA"
    if digits == 0:
        return f"{int(round(v)):,}"
    return f"{v:,.{digits}f}"


def esc(s):
    return html.escape(str(s), quote=True)


def bar_chart(data, label_key, series, width=820, height=300, max_value=None, stacked=False, suffix=""):
    margin = {"top": 22, "right": 18, "bottom": 56, "left": 52}
    plot_w = width - margin["left"] - margin["right"]
    plot_h = height - margin["top"] - margin["bottom"]
    if max_value is None:
        if stacked:
            max_value = max(sum(float(d.get(k, 0) or 0) for k, _name, _color in series) for d in data) if data else 1
        else:
            max_value = max(float(d.get(k, 0) or 0) for d in data for k, _name, _color in series) if data else 1
    max_value = max(max_value, 1)
    ticks = [0, max_value * 0.25, max_value * 0.5, max_value * 0.75, max_value]
    svg = [f'<svg viewBox="0 0 {width} {height}" role="img">']
    for t in ticks:
        y = margin["top"] + plot_h - (t / max_value) * plot_h
        svg.append(f'<line x1="{margin["left"]}" y1="{y:.1f}" x2="{width-margin["right"]}" y2="{y:.1f}" stroke="{COLORS["grid"]}" />')
        svg.append(f'<text x="{margin["left"]-10}" y="{y+4:.1f}" text-anchor="end" class="axis">{t:.0f}{suffix}</text>')
    n = max(len(data), 1)
    group_w = plot_w / n
    if stacked:
        bar_w = min(42, group_w * 0.58)
        for i, d in enumerate(data):
            x = margin["left"] + i * group_w + (group_w - bar_w) / 2
            y_cursor = margin["top"] + plot_h
            total = 0
            for key, name, color in series:
                val = float(d.get(key, 0) or 0)
                h = (val / max_value) * plot_h
                y = y_cursor - h
                if h > 0:
                    svg.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w:.1f}" height="{h:.1f}" fill="{color}"><title>{esc(d[label_key])} {esc(name)} {val:.1f}{suffix}</title></rect>')
                y_cursor = y
                total += val
            svg.append(f'<text x="{x+bar_w/2:.1f}" y="{max(12, y_cursor-6):.1f}" text-anchor="middle" class="barlabel">{total:.1f}{suffix}</text>')
            svg.append(f'<text x="{x+bar_w/2:.1f}" y="{height-22}" text-anchor="middle" class="axis label-rot">{esc(d[label_key])}</text>')
    else:
        bar_w = min(34, group_w * 0.7 / max(len(series), 1))
        for i, d in enumerate(data):
            base_x = margin["left"] + i * group_w + (group_w - bar_w * len(series)) / 2
            for j, (key, name, color) in enumerate(series):
                val = float(d.get(key, 0) or 0)
                h = (val / max_value) * plot_h
                x = base_x + j * bar_w
                y = margin["top"] + plot_h - h
                svg.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w-2:.1f}" height="{h:.1f}" fill="{color}"><title>{esc(d[label_key])} {esc(name)} {val:.1f}{suffix}</title></rect>')
                svg.append(f'<text x="{x+(bar_w-2)/2:.1f}" y="{y-5:.1f}" text-anchor="middle" class="barlabel">{val:.0f}{suffix}</text>')
            svg.append(f'<text x="{margin["left"] + i * group_w + group_w/2:.1f}" y="{height-22}" text-anchor="middle" class="axis">{esc(d[label_key])}</text>')
    svg.append("</svg>")
    return "\n".join(svg)


def line_bar_monthly(data, width=960, height=330):
    margin = {"top": 22, "right": 42, "bottom": 58, "left": 52}
    plot_w = width - margin["left"] - margin["right"]
    plot_h = height - margin["top"] - margin["bottom"]
    max_value = 104
    n = max(len(data), 1)
    group_w = plot_w / n
    bar_w = min(36, group_w * 0.58)
    svg = [f'<svg viewBox="0 0 {width} {height}" role="img">']
    for t in [0, 25, 50, 75, 98, 100]:
        y = margin["top"] + plot_h - (t / max_value) * plot_h
        color = "#9CA3AF" if t in (98, 100) else COLORS["grid"]
        dash = ' stroke-dasharray="5 4"' if t == 98 else ""
        svg.append(f'<line x1="{margin["left"]}" y1="{y:.1f}" x2="{width-margin["right"]}" y2="{y:.1f}" stroke="{color}"{dash} />')
        svg.append(f'<text x="{margin["left"]-10}" y="{y+4:.1f}" text-anchor="end" class="axis">{t}%</text>')
    points = []
    for i, d in enumerate(data):
        x = margin["left"] + i * group_w + (group_w - bar_w) / 2
        y_cursor = margin["top"] + plot_h
        for key, color in [("long_pct", COLORS["long"]), ("short_pct", COLORS["short"]), ("unknown_pct", COLORS["unknown"])]:
            val = float(d.get(key, 0) or 0)
            h = (val / max_value) * plot_h
            y = y_cursor - h
            svg.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w:.1f}" height="{h:.1f}" fill="{color}"><title>{esc(d["month"])} {key} {val:.1f}%</title></rect>')
            y_cursor = y
        gx = x + bar_w / 2
        gy = margin["top"] + plot_h - (float(d["goal_pct"]) / max_value) * plot_h
        points.append((gx, gy))
        svg.append(f'<text x="{gx:.1f}" y="{height-24}" text-anchor="middle" class="axis small">{esc(d["month"][5:])}</text>')
    if points:
        path = " ".join(("M" if i == 0 else "L") + f"{x:.1f},{y:.1f}" for i, (x, y) in enumerate(points))
        svg.append(f'<path d="{path}" fill="none" stroke="{COLORS["green"]}" stroke-width="3" />')
        for x, y in points:
            svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.5" fill="{COLORS["green"]}" />')
    svg.append(f'<text x="{width-margin["right"]}" y="{margin["top"]+12}" text-anchor="end" class="axis">点線: 98%目標</text>')
    svg.append("</svg>")
    return "\n".join(svg)


def route_case_sql(floors_filter=""):
    return f"""
    WITH long_eps AS (
        SELECT episode_id,user_id,user_name,admission_date,
               COALESCE(NULLIF(admission_floor,''), latest_floor) floor,
               discharge_date,last_seen_date,is_current,discharge_destination,
               discharge_reason,stay_days
        FROM resident_episodes
        WHERE admission_type='長期'
          AND admission_date>='2025-04-01'
          {floors_filter}
    ),
    prior AS (
        SELECT e.*,
               (SELECT MIN(usage_date)
                  FROM day_service_usage d
                 WHERE d.matched_user_id=e.user_id
                   AND d.match_status='matched'
                   AND d.usage_date < e.admission_date) first_day_before,
               (SELECT MIN(snapshot_date)
                  FROM resident_daily_stays s
                 WHERE s.user_id=e.user_id
                   AND s.stay_type='short_stay'
                   AND s.snapshot_date < e.admission_date) first_short_before
        FROM long_eps e
    ),
    routed AS (
        SELECT *,
               CASE
                 WHEN first_short_before IS NOT NULL
                  AND first_day_before IS NOT NULL
                  AND first_day_before <= first_short_before
                   THEN 'デイ→ショート→ロング'
                 WHEN first_short_before IS NOT NULL
                  AND first_day_before IS NOT NULL
                   THEN 'ショート＋デイ→ロング'
                 WHEN first_short_before IS NOT NULL
                   THEN 'ショート→ロング'
                 WHEN first_day_before IS NOT NULL
                   THEN 'デイ→ロング直接'
                 ELSE 'ロング直接/履歴なし'
               END route,
               CASE
                 WHEN discharge_date IS NULL OR discharge_date='' THEN '在所中'
                 WHEN discharge_reason='施設内移動'
                   OR discharge_destination IN ('2F','3F','ユニット') THEN '施設内移動'
                 ELSE '外部流出'
               END outflow_type
        FROM prior
    )
    """


def build():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB)
    cap = one(conn, "SELECT SUM(capacity) capacity FROM floor_capacity")["capacity"]
    monthly = rows(conn, f"""
        WITH m AS (
            SELECT substr(snapshot_date,1,7) month,
                   COUNT(DISTINCT snapshot_date) days,
                   SUM(CASE WHEN stay_type='long_stay' THEN 1 ELSE 0 END) long_days,
                   SUM(CASE WHEN stay_type='short_stay' THEN 1 ELSE 0 END) short_days,
                   SUM(CASE WHEN stay_type='unknown_resident_stay' THEN 1 ELSE 0 END) unknown_days
              FROM resident_daily_stays
             GROUP BY 1
        )
        SELECT month, days, long_days, short_days, unknown_days,
               ROUND(100.0*long_days/(days*{cap}),1) long_pct,
               ROUND(100.0*short_days/(days*{cap}),1) short_pct,
               ROUND(100.0*unknown_days/(days*{cap}),1) unknown_pct,
               ROUND(100.0*(long_days+short_days)/(days*{cap}),1) goal_pct
          FROM m
         ORDER BY month
    """)
    periods = rows(conn, f"""
        WITH m AS (
            SELECT substr(snapshot_date,1,7) month,
                   COUNT(DISTINCT snapshot_date) days,
                   SUM(CASE WHEN stay_type='long_stay' THEN 1 ELSE 0 END) long_days,
                   SUM(CASE WHEN stay_type='short_stay' THEN 1 ELSE 0 END) short_days,
                   SUM(CASE WHEN stay_type='unknown_resident_stay' THEN 1 ELSE 0 END) unknown_days
              FROM resident_daily_stays
             GROUP BY 1
        ),
        p AS (
            SELECT CASE
                     WHEN month BETWEEN '2025-04' AND '2025-05' THEN '2025年4-5月'
                     WHEN month BETWEEN '2026-01' AND '2026-03' THEN '2026年1-3月'
                     WHEN month BETWEEN '2026-04' AND '2026-05' THEN '2026年4-5月'
                   END period,
                   SUM(days*{cap}) cap_days,
                   SUM(long_days) long_days,
                   SUM(short_days) short_days,
                   SUM(unknown_days) unknown_days
              FROM m
             WHERE period IS NOT NULL
             GROUP BY 1
        )
        SELECT period, cap_days, long_days, short_days, unknown_days,
               ROUND(100.0*(long_days+short_days)/cap_days,1) goal_pct,
               ROUND(100.0*long_days/cap_days,1) long_pct,
               ROUND(100.0*short_days/cap_days,1) short_pct,
               ROUND(100.0*unknown_days/cap_days,1) unknown_pct
          FROM p
         ORDER BY period
    """)
    period_by_name = {r["period"]: r for r in periods}
    recent = period_by_name["2026年4-5月"]
    yoy = period_by_name["2025年4-5月"]
    target_98_days = recent["cap_days"] * 0.98
    gap_to_98_days = target_98_days - (recent["long_days"] + recent["short_days"])
    gap_to_98_beds = gap_to_98_days / (recent["cap_days"] / cap)
    yoy_goal_gap_days = (yoy["long_days"] + yoy["short_days"]) - (recent["long_days"] + recent["short_days"])
    yoy_short_gap_days = yoy["short_days"] - recent["short_days"]
    yoy_long_gap_days = yoy["long_days"] - recent["long_days"]

    floor_recent = rows(conn, f"""
        WITH d AS (
            SELECT floor,
                   COUNT(DISTINCT snapshot_date) days,
                   SUM(CASE WHEN stay_type='long_stay' THEN 1 ELSE 0 END) long_days,
                   SUM(CASE WHEN stay_type='short_stay' THEN 1 ELSE 0 END) short_days,
                   SUM(CASE WHEN stay_type='unknown_resident_stay' THEN 1 ELSE 0 END) unknown_days
              FROM resident_daily_stays
             WHERE snapshot_date BETWEEN '2026-04-01' AND '2026-05-31'
             GROUP BY floor
        )
        SELECT d.floor, fc.capacity, d.days, long_days, short_days, unknown_days,
               ROUND(100.0*(long_days+short_days)/(d.days*fc.capacity),1) goal_pct,
               ROUND(1.0*(long_days+short_days)/d.days,1) avg_goal_beds,
               ROUND(1.0*short_days/d.days,1) avg_short_beds
          FROM d JOIN floor_capacity fc USING(floor)
         ORDER BY CASE d.floor WHEN '2F' THEN 1 WHEN '3F' THEN 2 ELSE 3 END
    """)

    routes_23 = rows(conn, route_case_sql("AND COALESCE(NULLIF(admission_floor,''), latest_floor) IN ('2F','3F')") + """
        SELECT route, COUNT(*) episodes,
               ROUND(100.0*COUNT(*)/(SELECT COUNT(*) FROM routed),1) pct,
               SUM(CASE WHEN floor='2F' THEN 1 ELSE 0 END) floor_2f,
               SUM(CASE WHEN floor='3F' THEN 1 ELSE 0 END) floor_3f,
               SUM(CASE WHEN outflow_type='在所中' THEN 1 ELSE 0 END) current,
               SUM(CASE WHEN outflow_type='施設内移動' THEN 1 ELSE 0 END) internal_moves,
               SUM(CASE WHEN outflow_type='外部流出' THEN 1 ELSE 0 END) external_outflows
          FROM routed
         GROUP BY route
         ORDER BY episodes DESC
    """)

    outflow = rows(conn, route_case_sql("") + """
        SELECT route, COUNT(*) episodes,
               SUM(CASE WHEN admission_date <= date('2026-05-31','-90 day') THEN 1 ELSE 0 END) eligible_90d,
               SUM(CASE WHEN admission_date <= date('2026-05-31','-90 day')
                         AND discharge_date IS NOT NULL AND discharge_date<>''
                         AND julianday(discharge_date)-julianday(admission_date)<=90
                        THEN 1 ELSE 0 END) discharged_90d,
               ROUND(100.0*SUM(CASE WHEN admission_date <= date('2026-05-31','-90 day')
                         AND discharge_date IS NOT NULL AND discharge_date<>''
                         AND julianday(discharge_date)-julianday(admission_date)<=90
                        THEN 1 ELSE 0 END)
                    / NULLIF(SUM(CASE WHEN admission_date <= date('2026-05-31','-90 day') THEN 1 ELSE 0 END),0),1) discharge_90d_pct,
               SUM(CASE WHEN outflow_type='外部流出' THEN 1 ELSE 0 END) external_outflows,
               SUM(CASE WHEN outflow_type='施設内移動' THEN 1 ELSE 0 END) internal_moves
          FROM routed
         GROUP BY route
         ORDER BY episodes DESC
    """)

    day_coverage = one(conn, """
        WITH names AS (
            SELECT user_name_key, match_status, MAX(NULLIF(matched_user_id,'')) user_id
              FROM day_service_usage
             GROUP BY user_name_key, match_status
        )
        SELECT COUNT(*) unique_day_users,
               SUM(CASE WHEN match_status='matched' THEN 1 ELSE 0 END) matched_day_users,
               SUM(CASE WHEN match_status<>'matched' THEN 1 ELSE 0 END) non_admitted_day_users
          FROM names
    """)
    day_funnel = one(conn, """
        WITH day_users AS (
            SELECT matched_user_id user_id,
                   MIN(usage_date) first_day
              FROM day_service_usage
             WHERE match_status='matched'
             GROUP BY matched_user_id
        ),
        first_short AS (
            SELECT user_id, MIN(snapshot_date) first_short
              FROM resident_daily_stays
             WHERE stay_type='short_stay'
             GROUP BY user_id
        ),
        first_long AS (
            SELECT user_id, MIN(admission_date) first_long
              FROM resident_episodes
             WHERE admission_type='長期'
             GROUP BY user_id
        )
        SELECT COUNT(*) matched_day_users,
               SUM(CASE WHEN first_short IS NOT NULL AND first_short >= first_day THEN 1 ELSE 0 END) day_to_short_users,
               SUM(CASE WHEN first_short IS NOT NULL AND first_short >= first_day
                         AND first_long IS NOT NULL AND first_long >= first_short THEN 1 ELSE 0 END) day_short_long_users,
               SUM(CASE WHEN first_short IS NULL AND first_long IS NOT NULL AND first_long >= first_day THEN 1 ELSE 0 END) day_direct_long_users
          FROM day_users d
          LEFT JOIN first_short s USING(user_id)
          LEFT JOIN first_long l USING(user_id)
    """)
    day_total = day_coverage["unique_day_users"]
    day_funnel_chart = [
        {"label": "デイ利用者", "users": day_total},
        {"label": "入所未利用", "users": day_coverage["non_admitted_day_users"]},
        {"label": "デイ後ショート", "users": day_funnel["day_to_short_users"]},
        {"label": "デイ→ショート→ロング", "users": day_funnel["day_short_long_users"]},
        {"label": "デイ→ロング直接", "users": day_funnel["day_direct_long_users"]},
    ]

    short_buckets = rows(conn, """
        WITH short_users AS (
            SELECT user_id,
                   MIN(snapshot_date) first_short,
                   MAX(snapshot_date) last_short,
                   COUNT(DISTINCT snapshot_date) short_days
              FROM resident_daily_stays
             WHERE stay_type='short_stay'
             GROUP BY user_id
        ),
        b AS (
            SELECT CASE
                     WHEN short_days BETWEEN 1 AND 3 THEN '1-3日'
                     WHEN short_days BETWEEN 4 AND 7 THEN '4-7日'
                     WHEN short_days BETWEEN 8 AND 14 THEN '8-14日'
                     WHEN short_days BETWEEN 15 AND 30 THEN '15-30日'
                     ELSE '31日以上'
                   END bucket,
                   CASE
                     WHEN short_days BETWEEN 1 AND 3 THEN 1
                     WHEN short_days BETWEEN 4 AND 7 THEN 2
                     WHEN short_days BETWEEN 8 AND 14 THEN 3
                     WHEN short_days BETWEEN 15 AND 30 THEN 4
                     ELSE 5
                   END ord,
                   COUNT(*) users,
                   SUM(CASE WHEN EXISTS (
                        SELECT 1 FROM resident_episodes e
                         WHERE e.user_id=s.user_id
                           AND e.admission_type='長期'
                           AND e.admission_date>=s.first_short
                   ) THEN 1 ELSE 0 END) converted
              FROM short_users s
             GROUP BY bucket, ord
        )
        SELECT bucket, users, converted,
               ROUND(100.0*converted/users,1) conversion_pct
          FROM b
         ORDER BY ord
    """)
    short_15plus = one(conn, """
        WITH short_users AS (
            SELECT user_id, MIN(snapshot_date) first_short, MAX(snapshot_date) last_short,
                   COUNT(DISTINCT snapshot_date) short_days
              FROM resident_daily_stays
             WHERE stay_type='short_stay'
             GROUP BY user_id
        )
        SELECT COUNT(*) users,
               SUM(CASE WHEN EXISTS (
                    SELECT 1 FROM resident_episodes e
                     WHERE e.user_id=s.user_id
                       AND e.admission_type='長期'
                       AND e.admission_date>=s.first_short
               ) THEN 1 ELSE 0 END) converted,
               SUM(CASE WHEN last_short >= '2026-03-01'
                         AND NOT EXISTS (
                           SELECT 1 FROM resident_episodes e
                            WHERE e.user_id=s.user_id
                              AND e.admission_type='長期'
                              AND e.admission_date>=s.first_short
                         )
                        THEN 1 ELSE 0 END) recent_not_converted
          FROM short_users s
         WHERE short_days >= 15
    """)
    for r in short_buckets:
        r["conversion_bar"] = r["conversion_pct"]

    route_chart_data = [{"route": r["route"], "episodes": r["episodes"]} for r in routes_23]
    outflow_chart_data = [
        {
            "route": r["route"],
            "rate": r["discharge_90d_pct"] if r["discharge_90d_pct"] is not None else 0,
        }
        for r in outflow
        if r["eligible_90d"]
    ]
    period_chart_data = [
        {
            "period": r["period"].replace("年", "\n").replace("月", "月"),
            "long_pct": r["long_pct"],
            "short_pct": r["short_pct"],
            "unknown_pct": r["unknown_pct"],
        }
        for r in periods
    ]

    metrics = {
        "capacity": cap,
        "recent_2026_apr_may": recent,
        "yoy_2025_apr_may": yoy,
        "gap_to_98_days": gap_to_98_days,
        "gap_to_98_beds_per_day": gap_to_98_beds,
        "yoy_goal_gap_days": yoy_goal_gap_days,
        "yoy_short_gap_days": yoy_short_gap_days,
        "yoy_long_gap_days": yoy_long_gap_days,
        "floor_recent": floor_recent,
        "routes_2f_3f": routes_23,
        "outflow_by_route": outflow,
        "day_coverage": day_coverage,
        "day_funnel": day_funnel,
        "short_buckets": short_buckets,
        "short_15plus": short_15plus,
    }
    OUT_JSON.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")

    cards = [
        ("直近入所率", fmt_pct(recent["goal_pct"]), "2026年4-5月、ショート+ロング/100床"),
        ("98%までの不足", f"{fmt_num(gap_to_98_beds, 1)}床/日", f"{fmt_num(gap_to_98_days)}床日を追加すると到達"),
        ("前年差の主因", f"ショート {fmt_num(yoy_short_gap_days)}床日減", f"ロングは前年差 {fmt_num(-yoy_long_gap_days)}床日増"),
        ("最多流入経路", "ショート→ロング", f"2F/3Fで{routes_23[0]['episodes']}件、{fmt_pct(routes_23[0]['pct'])}"),
        ("デイ後ショート化", fmt_pct(pct(day_funnel["day_to_short_users"], day_total)), f"{day_funnel['day_to_short_users']}/{day_total}名"),
        ("ショート15日以上", fmt_pct(pct(short_15plus["converted"], short_15plus["users"])), f"ロング転換 {short_15plus['converted']}/{short_15plus['users']}名"),
    ]
    card_html = "\n".join(
        f'<div class="card"><div class="k">{esc(k)}</div><div class="v">{esc(v)}</div><div class="n">{esc(n)}</div></div>'
        for k, v, n in cards
    )

    floor_rows = "\n".join(
        f"<tr><td>{esc(r['floor'])}</td><td>{fmt_pct(r['goal_pct'])}</td><td>{fmt_num(r['avg_goal_beds'],1)} / {r['capacity']}床</td><td>{fmt_num(r['avg_short_beds'],1)}床/日</td></tr>"
        for r in floor_recent
    )
    route_rows = "\n".join(
        f"<tr><td>{esc(r['route'])}</td><td>{r['episodes']}</td><td>{fmt_pct(r['pct'])}</td><td>{r['floor_2f']}</td><td>{r['floor_3f']}</td><td>{r['current']}</td><td>{r['internal_moves']}</td><td>{r['external_outflows']}</td></tr>"
        for r in routes_23
    )
    outflow_rows = "\n".join(
        f"<tr><td>{esc(r['route'])}</td><td>{r['episodes']}</td><td>{r['eligible_90d']}</td><td>{r['discharged_90d']}</td><td>{fmt_pct(r['discharge_90d_pct'])}</td><td>{r['internal_moves']}</td><td>{r['external_outflows']}</td></tr>"
        for r in outflow
    )
    short_rows = "\n".join(
        f"<tr><td>{esc(r['bucket'])}</td><td>{r['users']}</td><td>{r['converted']}</td><td>{fmt_pct(r['conversion_pct'])}</td></tr>"
        for r in short_buckets
    )

    html_text = f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>ALBOS 入所率改善のためのデータ分析</title>
<style>
body {{ margin:0; background:{COLORS['bg']}; color:{COLORS['ink']}; font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",Meiryo,sans-serif; line-height:1.62; }}
main {{ max-width:1120px; margin:0 auto; padding:38px 30px 64px; }}
section {{ background:#fff; border:1px solid #E5E7EB; border-radius:8px; padding:24px; margin:18px 0; box-shadow:0 1px 2px rgba(15,23,42,.04); }}
h1 {{ font-size:30px; margin:0 0 8px; letter-spacing:0; }}
h2 {{ font-size:20px; margin:0 0 14px; letter-spacing:0; }}
h3 {{ font-size:16px; margin:20px 0 8px; }}
p {{ margin:8px 0; }}
.lead {{ font-size:17px; max-width:900px; }}
.muted {{ color:{COLORS['muted']}; font-size:13px; }}
.cards {{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:18px 0 2px; }}
.card {{ border:1px solid #E5E7EB; border-radius:8px; padding:14px 16px; background:#FAFAFA; min-height:92px; }}
.k {{ color:{COLORS['muted']}; font-size:13px; }}
.v {{ font-size:26px; font-weight:750; margin:4px 0; }}
.n {{ color:{COLORS['muted']}; font-size:13px; }}
.grid2 {{ display:grid; grid-template-columns:1fr 1fr; gap:18px; align-items:start; }}
.legend {{ display:flex; gap:16px; flex-wrap:wrap; margin:6px 0 12px; font-size:13px; color:{COLORS['muted']}; }}
.dot {{ display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:5px; vertical-align:-1px; }}
table {{ width:100%; border-collapse:collapse; font-size:14px; margin-top:10px; }}
th, td {{ border-bottom:1px solid #E5E7EB; padding:8px 9px; text-align:right; }}
th:first-child, td:first-child {{ text-align:left; }}
th {{ color:{COLORS['muted']}; font-weight:650; background:#FAFAFA; }}
svg {{ width:100%; height:auto; }}
.axis {{ fill:{COLORS['muted']}; font-size:12px; }}
.axis.small {{ font-size:11px; }}
.barlabel {{ fill:{COLORS['ink']}; font-size:11px; font-weight:650; }}
.callout {{ border-left:5px solid {COLORS['short']}; background:#FFF8F0; padding:14px 16px; border-radius:6px; }}
.good {{ border-left-color:{COLORS['green']}; background:#F3FAF7; }}
.warn {{ border-left-color:{COLORS['red']}; background:#FFF5F5; }}
ul {{ margin:8px 0 0 20px; padding:0; }}
li {{ margin:6px 0; }}
@media print {{
  body {{ background:#fff; }}
  main {{ max-width:none; padding:18px; }}
  section {{ break-inside:avoid; box-shadow:none; }}
}}
</style>
</head>
<body>
<main>
<header>
<h1>ALBOS 入所率改善のためのデータ分析</h1>
<p class="lead">目的は「ショート+ロングの入所率 / 100床」の改善。現データでは、短期施策はショート稼働の回復、中期施策はショート利用者のロング化、長期施策はデイ利用者をショートへ誘導する母集団形成が妥当です。</p>
<p class="muted">対象データ: 入所日次 2025-04-01から2026-05-31、デイサービス 2025-04-01から2026-06-08。前提: デイ未照合者は、この1年でショート/ロングを使っていない利用者として扱う。</p>
</header>

<section>
<h2>1. 結論</h2>
<div class="cards">{card_html}</div>
<div class="callout">
<p><strong>意思決定:</strong> 入所率を短期で上げるには、デイ利用者数そのものではなく、ショート床日を増やす必要があります。2026年4-5月の入所率は{fmt_pct(recent['goal_pct'])}で、98%到達には{fmt_num(gap_to_98_days)}床日、平均{fmt_num(gap_to_98_beds,1)}床/日の追加が必要です。</p>
</div>
</section>

<section>
<h2>2. 月別入所率の推移</h2>
<div class="legend">
<span><i class="dot" style="background:{COLORS['long']}"></i>ロング</span>
<span><i class="dot" style="background:{COLORS['short']}"></i>ショート</span>
<span><i class="dot" style="background:{COLORS['unknown']}"></i>分類不明</span>
<span><i class="dot" style="background:{COLORS['green']}"></i>ショート+ロング入所率</span>
</div>
{line_bar_monthly(monthly)}
<p>2026年4-5月のショート+ロング入所率は{fmt_pct(recent['goal_pct'])}。分類不明を含めた見かけの稼働ではなく、目標指標に合わせてショート+ロングだけで評価しています。</p>
</section>

<section>
<h2>3. 低下要因の分解</h2>
<div class="grid2">
<div>
{bar_chart(period_chart_data, 'period', [('long_pct','ロング',COLORS['long']),('short_pct','ショート',COLORS['short']),('unknown_pct','分類不明',COLORS['unknown'])], width=520, height=310, max_value=104, stacked=True, suffix='%')}
</div>
<div>
<h3>2025年4-5月比</h3>
<p>ショート+ロング床日は{fmt_num(yoy['long_days'] + yoy['short_days'])}床日から{fmt_num(recent['long_days'] + recent['short_days'])}床日に低下。前年差は{fmt_num(yoy_goal_gap_days)}床日です。</p>
<p>内訳は、ショートが{fmt_num(yoy_short_gap_days)}床日減、ロングは{fmt_num(-yoy_long_gap_days)}床日増。つまり、前年差の穴はショート減少で説明できます。</p>
<h3>直近フロア別</h3>
<table><thead><tr><th>フロア</th><th>入所率</th><th>平均入所床</th><th>平均ショート床</th></tr></thead><tbody>{floor_rows}</tbody></table>
</div>
</div>
</section>

<section>
<h2>4. 流入経路</h2>
<div class="grid2">
<div>
{bar_chart(route_chart_data, 'route', [('episodes','件数',COLORS['long'])], width=520, height=320)}
</div>
<div>
<p>2F/3Fのロング入所では、最多経路はショート→ロングです。デイ→ショート→ロングは存在しますが、現データでは主流ではありません。</p>
<table><thead><tr><th>経路</th><th>件数</th><th>構成比</th><th>2F</th><th>3F</th><th>在所中</th><th>施設内移動</th><th>外部流出</th></tr></thead><tbody>{route_rows}</tbody></table>
</div>
</div>
</section>

<section>
<h2>5. デイ利用者は何につながっているか</h2>
<div class="grid2">
<div>
{bar_chart(day_funnel_chart, 'label', [('users','人数',COLORS['green'])], width=520, height=320)}
</div>
<div>
<p>デイ利用者は全{day_total}名。そのうち{day_coverage['non_admitted_day_users']}名は、この1年でショート/ロング未利用という前提です。</p>
<p>デイ後にショートへ進んだ人は{day_funnel['day_to_short_users']}名、全デイ利用者の{fmt_pct(pct(day_funnel['day_to_short_users'], day_total))}。デイ→ショート→ロングは{day_funnel['day_short_long_users']}名、{fmt_pct(pct(day_funnel['day_short_long_users'], day_total))}です。</p>
<div class="callout warn">
<p><strong>解釈:</strong> デイ利用者増加は入所率に直接効きません。入所率に効くのは、デイ利用者をショート利用へ移す運用がある場合です。</p>
</div>
</div>
</div>
</section>

<section>
<h2>6. ショート利用日数とロング転換</h2>
<div class="grid2">
<div>
{bar_chart(short_buckets, 'bucket', [('conversion_bar','転換率',COLORS['short'])], width=520, height=320, max_value=70, suffix='%')}
</div>
<div>
<p>ショート15日以上の利用者は{short_15plus['users']}名で、ロング転換は{short_15plus['converted']}名、転換率{fmt_pct(pct(short_15plus['converted'], short_15plus['users']))}。直近利用があり、15日以上使っていて未転換の候補は{short_15plus['recent_not_converted']}名です。</p>
<table><thead><tr><th>ショート日数</th><th>人数</th><th>ロング転換</th><th>転換率</th></tr></thead><tbody>{short_rows}</tbody></table>
</div>
</div>
</section>

<section>
<h2>7. 流出リスク</h2>
<div class="grid2">
<div>
{bar_chart(outflow_chart_data, 'route', [('rate','90日以内退所率',COLORS['red'])], width=520, height=320, max_value=60, suffix='%')}
</div>
<div>
<p>退所件数はまだ少ないため参考値ですが、ショート経由のロング入所は早期退所が少なく、ロング直接/履歴なしは90日以内退所が高めです。</p>
<table><thead><tr><th>経路</th><th>件数</th><th>90日評価対象</th><th>90日以内退所</th><th>率</th><th>施設内移動</th><th>外部流出</th></tr></thead><tbody>{outflow_rows}</tbody></table>
</div>
</div>
</section>

<section>
<h2>8. 提案</h2>
<div class="callout good">
<p><strong>短期施策:</strong> 2026年4-5月の98%到達には平均{fmt_num(gap_to_98_beds,1)}床/日の追加が必要です。前年差のショート減少{fmt_num(yoy_short_gap_days)}床日を戻すだけで、98%目標にかなり近づきます。</p>
</div>
<ul>
<li><strong>最優先:</strong> 直近ショート利用あり、累計15日以上、ロング未転換の{short_15plus['recent_not_converted']}名を営業リスト化する。</li>
<li><strong>2F:</strong> ショート経由のロング化が強い。ショート定期利用を増やし、15日以上利用へ伸ばす。</li>
<li><strong>3F:</strong> ロング直接/履歴なしが多いが、早期退所リスクが相対的に高い。3Fショート接点を作ってからロング提案する導線を強化する。</li>
<li><strong>デイ:</strong> デイ利用者の増加だけをKPIにしない。KPIは「デイ利用者のショート初回利用数」「ショート累計15日到達数」「ショートからロング相談化数」に置く。</li>
</ul>
</section>

<section>
<h2>9. データ上の注意</h2>
<ul>
<li>デイ未照合者は、この1年でショート/ロングを使っていない人として扱った。</li>
<li>ロング入所の紹介元カラムは全件「不明」のため、流入経路は利用履歴から復元した。</li>
<li>退所件数は少ないため、流出率は暫定値。追加3年分があると、流出リスクとデイ起点の転換率はより確からしくなる。</li>
</ul>
</section>
</main>
</body>
</html>
"""
    OUT_HTML.write_text(html_text, encoding="utf-8")
    print(OUT_HTML)
    print(OUT_JSON)


if __name__ == "__main__":
    build()
