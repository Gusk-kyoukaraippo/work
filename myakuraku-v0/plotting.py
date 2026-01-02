"""Plotting utilities."""
from __future__ import annotations

import json
import logging

import matplotlib.pyplot as plt
import pandas as pd


def _plot_with_matplotlib(df: pd.DataFrame, title: str, ylabel: str, output_path: str) -> None:
    plt.figure(figsize=(10, 6))
    for col in df.columns:
        plt.plot(df.index, df[col], label=col)
    plt.xlabel("Year")
    plt.ylabel(ylabel)
    plt.title(title)
    try:
        plt.legend()
    except Exception:
        pass
    try:
        plt.tight_layout()
    except Exception:
        pass
    plt.savefig(output_path)
    plt.close()


def _plot_with_pillow(df: pd.DataFrame, title: str, ylabel: str, output_path: str) -> None:
    from PIL import Image, ImageDraw

    width, height = 1000, 600
    margin = 80
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)

    years = list(df.index)
    if not years:
        img.save(output_path)
        return

    values = df.values.flatten().tolist()
    max_val = max(values) if values else 1
    max_val = max(1, max_val)

    plot_w = width - 2 * margin
    plot_h = height - 2 * margin

    def x_pos(i: int) -> float:
        if len(years) == 1:
            return margin + plot_w / 2
        return margin + (i / (len(years) - 1)) * plot_w

    def y_pos(v: float) -> float:
        return height - margin - (v / max_val) * plot_h

    # Axes
    draw.line((margin, margin, margin, height - margin), fill="black", width=2)
    draw.line((margin, height - margin, width - margin, height - margin), fill="black", width=2)

    # Title and labels (simple)
    draw.text((margin, 20), title, fill="black")
    draw.text((20, margin), ylabel, fill="black")

    # Plot lines
    colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b"]
    for idx, col in enumerate(df.columns):
        color = colors[idx % len(colors)]
        points = []
        for i, year in enumerate(years):
            points.append((x_pos(i), y_pos(float(df.loc[year, col]))))
        if len(points) >= 2:
            draw.line(points, fill=color, width=2)
        elif points:
            x, y = points[0]
            draw.ellipse((x - 2, y - 2, x + 2, y + 2), fill=color)

    img.save(output_path)


def plot_papers_over_time(pivot_csv: str, output_path: str) -> None:
    df = pd.read_csv(pivot_csv, index_col=0)
    try:
        _plot_with_matplotlib(df, "Papers Over Time by University", "Paper Count", output_path)
    except Exception as exc:
        logging.warning("Matplotlib failed (%s). Falling back to Pillow.", exc)
        _plot_with_pillow(df, "Papers Over Time by University", "Paper Count", output_path)


def plot_total_over_time(pivot_csv: str, output_path: str) -> None:
    df = pd.read_csv(pivot_csv, index_col=0)
    total = df.sum(axis=1)
    total_df = total.to_frame(name="Total")
    try:
        _plot_with_matplotlib(total_df, "Total Papers Over Time", "Total Paper Count", output_path)
    except Exception as exc:
        logging.warning("Matplotlib failed (%s). Falling back to Pillow.", exc)
        _plot_with_pillow(total_df, "Total Papers Over Time", "Total Paper Count", output_path)


def plot_if_by_university_year_slider(by_year_csv: str, output_html: str) -> None:
    df = pd.read_csv(by_year_csv)
    if df.empty:
        logging.warning("No data available for IF slider plot: %s", by_year_csv)
        return

    if "department" not in df.columns:
        df["department"] = "All Departments"

    df["weighted_count"] = pd.to_numeric(df["weighted_count"], errors="coerce").fillna(0.0)
    df["year"] = pd.to_numeric(df["year"], errors="coerce")
    df = df.dropna(subset=["year"])
    df["year"] = df["year"].astype(int)

    records = df[["year", "department", "university", "weighted_count"]].to_dict(orient="records")
    years = sorted(df["year"].unique().tolist())
    departments = sorted(df["department"].dropna().unique().tolist())
    universities = sorted(df["university"].dropna().unique().tolist())

    html = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Total IF by University</title>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js" charset="utf-8"></script>
  <style>
    :root {{
      color-scheme: light;
      --panel-bg: #f6f6f2;
      --panel-border: #d6d2c4;
      --accent: #395b50;
    }}
    body {{
      margin: 0;
      font-family: "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif;
      background: linear-gradient(180deg, #fbfbf8 0%, #f0efe8 100%);
      color: #1f1f1f;
    }}
    .toolbar {{
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
      padding: 16px 20px;
      background: var(--panel-bg);
      border-bottom: 1px solid var(--panel-border);
    }}
    .control {{
      display: flex;
      gap: 8px;
      align-items: center;
      font-size: 14px;
    }}
    select, input[type="range"], button {{
      font-size: 14px;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid var(--panel-border);
      background: white;
    }}
    button {{
      cursor: pointer;
      background: var(--accent);
      color: white;
      border: 1px solid var(--accent);
      padding: 6px 14px;
    }}
    #plot {{
      width: 100%;
      height: 450px;
    }}
    .year-label {{
      min-width: 52px;
      text-align: center;
      font-weight: 600;
      color: var(--accent);
    }}
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="control">
      <label for="department-select">Department</label>
      <select id="department-select"></select>
    </div>
    <div class="control">
      <label for="university-select">University</label>
      <select id="university-select"></select>
    </div>
    <div class="control">
      <label for="year-range">Year</label>
      <input id="year-range" type="range" />
      <span class="year-label" id="year-label"></span>
    </div>
    <div class="control">
      <button id="apply-button" type="button">Search</button>
    </div>
    <div class="control" id="selection-summary"></div>
  </div>
  <div id="plot"></div>
  <script>
    const RAW_DATA = {json.dumps(records, ensure_ascii=False)};
    const YEARS = {json.dumps(years)};
    const DEPARTMENTS = {json.dumps(departments, ensure_ascii=False)};
    const UNIVERSITIES = {json.dumps(universities, ensure_ascii=False)};
    const ALL_VALUE = "__all__";

    const departmentSelect = document.getElementById("department-select");
    const universitySelect = document.getElementById("university-select");
    const yearRange = document.getElementById("year-range");
    const yearLabel = document.getElementById("year-label");
    const applyButton = document.getElementById("apply-button");
    const selectionSummary = document.getElementById("selection-summary");
    let appliedSelection = {{
      department: ALL_VALUE,
      university: ALL_VALUE,
      year: YEARS.length > 0 ? YEARS[0] : null,
    }};

    function fillOptions(select, options, allLabel) {{
      select.innerHTML = "";
      const allOption = document.createElement("option");
      allOption.value = ALL_VALUE;
      allOption.textContent = allLabel;
      select.appendChild(allOption);
      options.forEach((opt) => {{
        const option = document.createElement("option");
        option.value = opt;
        option.textContent = opt;
        select.appendChild(option);
      }});
    }}

    function updateUniversityOptions() {{
      const dept = departmentSelect.value;
      const filtered = dept === ALL_VALUE
        ? RAW_DATA
        : RAW_DATA.filter((d) => d.department === dept);
      const univs = Array.from(new Set(filtered.map((d) => d.university))).sort();
      const current = universitySelect.value;
      fillOptions(universitySelect, univs, "All universities");
      if (current !== ALL_VALUE && univs.includes(current)) {{
        universitySelect.value = current;
      }}
    }}

    function render() {{
      const dept = appliedSelection.department;
      const univ = appliedSelection.university;
      const year = appliedSelection.year;
      yearLabel.textContent = String(year);

      let filtered = RAW_DATA.filter((d) => d.year === year);
      if (dept !== ALL_VALUE) {{
        filtered = filtered.filter((d) => d.department === dept);
      }}
      if (univ !== ALL_VALUE) {{
        filtered = filtered.filter((d) => d.university === univ);
      }}

      filtered.sort((a, b) => b.weighted_count - a.weighted_count);

      const trace = {{
        type: "bar",
        orientation: "h",
        x: filtered.map((d) => d.weighted_count),
        y: filtered.map((d) => d.university),
        customdata: filtered.map((d) => [d.year, d.department]),
        hovertemplate:
          "Year=%{{customdata[0]}}<br>" +
          "Department=%{{customdata[1]}}<br>" +
          "Total IF=%{{x}}<br>" +
          "University=%{{y}}<extra></extra>",
        marker: {{ color: "#395b50" }},
      }};

      const titleSuffix = dept !== ALL_VALUE ? ` - ${{dept}}` : "";
      const layout = {{
        title: `Total IF by University${{titleSuffix}}`,
        xaxis: {{ title: "Total IF" }},
        yaxis: {{ title: "University", automargin: true }},
        height: Math.max(450, 30 * Math.max(filtered.length, 1)),
        margin: {{ l: 140, r: 40, t: 60, b: 60 }},
        annotations: [],
      }};

      if (filtered.length === 0) {{
        layout.annotations.push({{
          text: "No data for this selection",
          xref: "paper",
          yref: "paper",
          x: 0.5,
          y: 0.5,
          showarrow: false,
          font: {{ size: 16, color: "#666" }},
        }});
      }}

      Plotly.react("plot", [trace], layout, {{ responsive: true }});
      updateSelectionSummary(dept, univ, year);
    }}

    function updateSelectionSummary(dept, univ, year) {{
      const deptLabel = dept === ALL_VALUE ? "All departments" : dept;
      const univLabel = univ === ALL_VALUE ? "All universities" : univ;
      selectionSummary.textContent = `Selected: ${{deptLabel}} / ${{univLabel}} / ${{year}}`;
    }}

    function applySelection() {{
      appliedSelection = {{
        department: departmentSelect.value,
        university: universitySelect.value,
        year: Number(yearRange.value),
      }};
      render();
    }}

    function init() {{
      fillOptions(departmentSelect, DEPARTMENTS, "All departments");
      fillOptions(universitySelect, UNIVERSITIES, "All universities");
      if (YEARS.length > 0) {{
        yearRange.min = YEARS[0];
        yearRange.max = YEARS[YEARS.length - 1];
        yearRange.step = 1;
        yearRange.value = YEARS[0];
        yearLabel.textContent = String(YEARS[0]);
      }}
      updateUniversityOptions();
      applySelection();
    }}

    departmentSelect.addEventListener("change", updateUniversityOptions);
    applyButton.addEventListener("click", applySelection);
    yearRange.addEventListener("input", () => {{
      yearLabel.textContent = String(yearRange.value);
    }});

    init();
  </script>
</body>
</html>
"""

    with open(output_html, "w", encoding="utf-8") as f:
        f.write(html)
