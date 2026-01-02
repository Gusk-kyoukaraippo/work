"""CLI entrypoint for PubMed affiliation counts."""
from __future__ import annotations

import argparse
import logging
import os
from typing import List, Optional

from models import load_config
from pipeline import run_pipeline
from plotting import plot_if_by_university_year_slider, plot_papers_over_time, plot_total_over_time


def _parse_list(value: Optional[str]) -> Optional[List[str]]:
    if not value:
        return None
    return [v.strip() for v in value.split(",") if v.strip()]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="PubMed affiliation count by year")
    parser.add_argument("--config", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--start-year", type=int, default=None)
    parser.add_argument("--end-year", type=int, default=None)
    parser.add_argument("--universities", default=None)
    parser.add_argument("--departments", default=None)
    parser.add_argument("--no-cache", action="store_true")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    cfg = load_config(args.config)
    os.makedirs(args.output_dir, exist_ok=True)

    outputs = run_pipeline(
        cfg=cfg,
        output_dir=args.output_dir,
        override_start=args.start_year,
        override_end=args.end_year,
        select_universities=_parse_list(args.universities),
        select_departments=_parse_list(args.departments),
        no_cache=args.no_cache,
    )

    plot_papers_over_time(outputs["pivot_csv"], f"{args.output_dir}/papers_over_time.png")
    plot_total_over_time(outputs["pivot_csv"], f"{args.output_dir}/total_over_time.png")
    plot_if_by_university_year_slider(
        outputs["by_year_csv"], f"{args.output_dir}/if_by_university_year.html"
    )

    logging.info("Outputs saved under %s", args.output_dir)


if __name__ == "__main__":
    main()
