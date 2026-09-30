from pathlib import Path
from math import sin, pi
import glob

from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor, Color, white
from reportlab.lib.units import mm


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "院内DX_業務改善テーマ募集_仮組み.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

PAGE_W, PAGE_H = A4


def find_font(weight: str) -> str:
    matches = glob.glob(f"/System/Library/Fonts/*W{weight}.ttc")
    if not matches:
        raise FileNotFoundError(f"Hiragino W{weight} font was not found")
    return matches[0]


pdfmetrics.registerFont(TTFont("JP-Regular", find_font("3"), subfontIndex=0))
pdfmetrics.registerFont(TTFont("JP-Medium", find_font("6"), subfontIndex=0))
pdfmetrics.registerFont(TTFont("JP-Bold", find_font("8"), subfontIndex=0))


NAVY = HexColor("#061D46")
NAVY_2 = HexColor("#0A3474")
BLUE = HexColor("#065BCE")
CYAN = HexColor("#18A8F1")
PALE_BLUE = HexColor("#EAF4FF")
INK = HexColor("#101D38")
MUTED = HexColor("#5B667A")
LINE = HexColor("#CBD6E5")
LIGHT = HexColor("#F4F7FB")
ORANGE = HexColor("#F47A09")
GREEN = HexColor("#08703C")
PALE_GREEN = HexColor("#EDF7F0")


def X(v):
    return v * mm


def Y(v):
    return PAGE_H - v * mm


def rect(c, x, y, w, h, fill, stroke=None, radius=0, sw=0.6):
    c.setLineWidth(sw)
    c.setFillColor(fill)
    c.setStrokeColor(stroke or fill)
    if radius:
        c.roundRect(X(x), Y(y + h), X(w), X(h), X(radius), fill=1, stroke=1 if stroke else 0)
    else:
        c.rect(X(x), Y(y + h), X(w), X(h), fill=1, stroke=1 if stroke else 0)


def line(c, x1, y1, x2, y2, color=LINE, sw=0.6, dash=None):
    c.setStrokeColor(color)
    c.setLineWidth(sw)
    if dash:
        c.setDash(dash)
    else:
        c.setDash()
    c.line(X(x1), Y(y1), X(x2), Y(y2))
    c.setDash()


def text(c, value, x, y, size=8, font="JP-Regular", color=INK, anchor="left"):
    c.setFillColor(color)
    c.setFont(font, size)
    if anchor == "center":
        c.drawCentredString(X(x), Y(y), value)
    elif anchor == "right":
        c.drawRightString(X(x), Y(y), value)
    else:
        c.drawString(X(x), Y(y), value)


def centered_in(c, value, x, y, w, h, size=8, font="JP-Regular", color=INK, y_nudge=0):
    text(c, value, x + w / 2, y + h / 2 + size * 0.13 + y_nudge, size, font, color, "center")


def circle_num(c, n, x, y, color=BLUE):
    c.setFillColor(color)
    c.circle(X(x), Y(y), X(2.25), fill=1, stroke=0)
    text(c, str(n), x, y + 0.85, 5.2, "JP-Bold", white, "center")


def chevron(c, x, y, color=BLUE, scale=1.0):
    c.setStrokeColor(color)
    c.setLineWidth(1.25)
    c.line(X(x - 1.6 * scale), Y(y - 1.5 * scale), X(x), Y(y))
    c.line(X(x), Y(y), X(x - 1.6 * scale), Y(y + 1.5 * scale))


def speech_icon(c, x, y, color=BLUE, scale=1.0):
    c.setStrokeColor(color)
    c.setLineWidth(1.15)
    c.setFillColor(white)
    c.roundRect(X(x - 5 * scale), Y(y + 3.4 * scale), X(10 * scale), X(7 * scale), X(2.5 * scale), fill=1, stroke=1)
    c.line(X(x - 1.5 * scale), Y(y + 3.3 * scale), X(x - 3.2 * scale), Y(y + 5.1 * scale))
    for dx in (-2, 0, 2):
        c.setFillColor(color)
        c.circle(X(x + dx * scale), Y(y), X(0.45 * scale), fill=1, stroke=0)


def people_icon(c, x, y, color=BLUE, scale=1.0):
    c.setStrokeColor(color)
    c.setLineWidth(1.1)
    c.setFillColor(white)
    for dx, yy, rr in [(-4.0, y, 1.65), (0, y - 1.4, 1.95), (4.0, y, 1.65)]:
        c.circle(X(x + dx * scale), Y(yy), X(rr * scale), fill=1, stroke=1)
    for dx, yy, ww in [(-4.0, y + 4.7, 5.6), (0, y + 4.3, 6.7), (4.0, y + 4.7, 5.6)]:
        c.arc(X((x + dx) * scale - ww * scale / 2), Y(yy + 2.6 * scale), X((x + dx) * scale + ww * scale / 2), Y(yy - 2.6 * scale), 15, 150)


def clipboard_icon(c, x, y, color=GREEN, scale=1.0):
    c.setStrokeColor(color)
    c.setFillColor(white)
    c.setLineWidth(1.25)
    c.roundRect(X(x - 4.5 * scale), Y(y + 7 * scale), X(9 * scale), X(12 * scale), X(1.2 * scale), fill=1, stroke=1)
    c.roundRect(X(x - 2.1 * scale), Y(y + 8.3 * scale), X(4.2 * scale), X(2.2 * scale), X(0.7 * scale), fill=1, stroke=1)
    for yy in (-2.2, 1.1, 4.4):
        c.line(X(x - 2.7 * scale), Y(y + yy), X(x - 1.6 * scale), Y(y + yy + 1.0 * scale))
        c.line(X(x - 1.6 * scale), Y(y + yy + 1.0 * scale), X(x - 0.4 * scale), Y(y + yy - 0.5 * scale))
        c.line(X(x + 0.8 * scale), Y(y + yy + 0.2 * scale), X(x + 3.0 * scale), Y(y + yy + 0.2 * scale))


def trend_icon(c, x, y, color=BLUE, scale=1.0):
    c.setStrokeColor(color)
    c.setLineWidth(1.3)
    c.line(X(x - 5 * scale), Y(y + 4 * scale), X(x - 5 * scale), Y(y - 4 * scale))
    c.line(X(x - 5 * scale), Y(y + 4 * scale), X(x + 5 * scale), Y(y + 4 * scale))
    pts = [(-4, 2.8), (-1.5, 0.8), (0.5, 1.8), (4.7, -3.3)]
    for (a, b), (d, e) in zip(pts, pts[1:]):
        c.line(X(x + a * scale), Y(y + b * scale), X(x + d * scale), Y(y + e * scale))
    chevron(c, x + 4.7 * scale, y - 3.3 * scale, color, 0.75 * scale)


def draw_top(c):
    rect(c, 0, 0, 210, 58, NAVY)
    # Low-contrast wave lines create motion without competing with the copy.
    c.saveState()
    c.setStrokeColor(Color(0.05, 0.55, 0.95, alpha=0.45))
    for offset in (0, 2.2, 4.4):
        p = c.beginPath()
        p.moveTo(X(104), Y(54 - offset))
        p.curveTo(X(135), Y(45 - offset), X(160), Y(55 - offset), X(210), Y(36 - offset))
        c.setLineWidth(1.2)
        c.drawPath(p, fill=0, stroke=1)
    c.restoreState()

    text(c, "DX TEAM  |  院内業務改善", 8, 9, 6.6, "JP-Medium", HexColor("#B8D9FF"))
    text(c, "院内DX・", 8, 24.5, 18.5, "JP-Bold", white)
    text(c, "業務改善テーマ募集", 8, 43.5, 17.1, "JP-Bold", white)
    line(c, 8, 48.5, 23, 48.5, CYAN, 1.4)
    text(c, "解決策が決まっていなくても、気になる業務から。", 8, 54, 6.8, "JP-Medium", HexColor("#D7E9FF"))

    # BEFORE: layered paper forms.
    text(c, "BEFORE", 118, 10, 5.5, "JP-Bold", HexColor("#9CC9FF"))
    for i, (dx, dy, ang) in enumerate([(0, 0, -7), (4, 2, -2), (8, 4, 4)]):
        c.saveState()
        c.translate(X(120 + dx), Y(15 + dy))
        c.rotate(ang)
        c.setFillColor(Color(1, 1, 1, alpha=0.92 - i * 0.12))
        c.setStrokeColor(HexColor("#8FB9E8"))
        c.roundRect(0, -X(24), X(24), X(31), X(1.3), fill=1, stroke=1)
        for yy in (1, 5, 9, 13, 17):
            c.setStrokeColor(HexColor("#C3D4E8"))
            c.line(X(3), -X(yy), X(20), -X(yy))
        c.restoreState()

    # Flow arrow.
    c.setStrokeColor(CYAN)
    c.setLineWidth(2.4)
    c.line(X(153), Y(30), X(164), Y(30))
    chevron(c, 164, 30, CYAN, 1.5)

    # AFTER: a small, clean digital workflow screen.
    text(c, "AFTER", 169, 10, 5.5, "JP-Bold", HexColor("#9CC9FF"))
    c.saveState()
    c.setFillColor(HexColor("#F8FBFF"))
    c.setStrokeColor(HexColor("#7BB8FF"))
    c.setLineWidth(0.9)
    c.roundRect(X(168), Y(49), X(34), X(35), X(2.2), fill=1, stroke=1)
    centered_in(c, "申請・承認", 171, 16.5, 28, 7, 6.0, "JP-Bold", NAVY_2)
    for i, label in enumerate(["入力", "確認", "完了"]):
        yy = 26 + i * 7
        c.setFillColor(PALE_BLUE if i < 2 else PALE_GREEN)
        c.setStrokeColor(HexColor("#BCD2EC"))
        c.roundRect(X(172), Y(yy + 4.8), X(26), X(5.6), X(1.2), fill=1, stroke=1)
        text(c, f"{i + 1}", 174.3, yy + 3.1, 4.8, "JP-Bold", BLUE if i < 2 else GREEN, "center")
        text(c, label, 178, yy + 3.2, 5.1, "JP-Medium", INK)
        if i < 2:
            text(c, "✓", 195.3, yy + 3.25, 5.2, "JP-Bold", BLUE, "center")
    c.restoreState()


def draw_benefit(c):
    rect(c, 0, 58, 210, 38, white)
    text(c, "DXで何が変わるの？", 8, 64.8, 6.5, "JP-Medium", MUTED)
    text(c, "業務が変わります。", 42, 64.8, 7.4, "JP-Bold", NAVY)

    rect(c, 8, 69, 46, 14.5, LIGHT, LINE, 2)
    text(c, "そう言われても…", 12, 74.1, 5.3, "JP-Medium", MUTED)
    text(c, "仕事や面倒は増やしたくない。", 12, 79.8, 6.0, "JP-Medium", INK)

    text(c, "でも、", 64, 79.5, 14.5, "JP-Bold", ORANGE, "center")
    chevron(c, 75, 76.2, HexColor("#A9B4C4"), 1.0)

    benefits = [
        (80, "ストレス", "減らす", "●", BLUE),
        (121.5, "残業", "減らす", "◷", NAVY_2),
        (163, "やりがい", "増やす", "↗", GREEN),
    ]
    for x, a, b, glyph, col in benefits:
        rect(c, x, 68.5, 37.5, 15.5, white, HexColor("#D9E2EE"), 3)
        c.setFillColor(HexColor("#F0F6FD") if col != GREEN else PALE_GREEN)
        c.circle(X(x + 7), Y(76.2), X(4.4), fill=1, stroke=0)
        if glyph == "●":
            c.setFillColor(col)
            c.circle(X(x + 7), Y(76.0), X(1.25), fill=1, stroke=0)
            c.setLineWidth(1.0)
            c.setStrokeColor(col)
            c.arc(X(x + 4.2), Y(80.2), X(x + 9.8), Y(75.6), 200, 140)
        else:
            text(c, glyph, x + 7, 78.1, 9.0, "JP-Bold", col, "center")
        text(c, a, x + 13, 74.6, 6.5, "JP-Bold", col)
        text(c, b, x + 13, 80.3, 6.3, "JP-Medium", INK)

    line(c, 8, 87.0, 202, 87.0, HexColor("#DCE4EF"), 0.5)
    text(c, "今までと一味違った形で、", 105, 92.1, 7.0, "JP-Medium", NAVY, "right")
    text(c, "業務を楽にしていく。", 106.5, 92.1, 8.6, "JP-Bold", BLUE)


def draw_case1(c, x, y, w, h):
    rect(c, x, y, w, h, white, LINE, 2.4)
    rect(c, x + 2.4, y + 2.1, 27, 6.4, BLUE, radius=1.2)
    centered_in(c, "CASE 01 ｜ 集計業務", x + 2.4, y + 2.1, 27, 6.4, 5.5, "JP-Bold", white, 0.15)
    rect(c, x + w - 18, y + 2.1, 15.5, 6.4, HexColor("#FFF1E5"), radius=3)
    centered_in(c, "実績（仮）", x + w - 18, y + 2.1, 15.5, 6.4, 4.8, "JP-Medium", ORANGE, 0.1)

    text(c, "毎月8時間", x + 7, y + 16.0, 10.3, "JP-Bold", INK)
    text(c, "→", x + 34, y + 16.1, 11.0, "JP-Bold", BLUE)
    text(c, "20分", x + 48, y + 16.0, 11.4, "JP-Bold", BLUE)

    rect(c, x + 4, y + 21, w - 8, h - 25, LIGHT, HexColor("#D9E3EF"), 2)
    text(c, "売上集計レポート（画面イメージ）", x + 7, y + 27, 5.2, "JP-Medium", INK)
    # Tiny table.
    tx, ty, tw, th = x + 7, y + 30.5, 35, 17
    rect(c, tx, ty, tw, th, white, HexColor("#DCE4EE"), 0.8)
    rect(c, tx, ty, tw, 4.4, PALE_BLUE)
    for xx in (tx + 14, tx + 25):
        line(c, xx, ty, xx, ty + th, HexColor("#DCE4EE"), 0.35)
    for yy in (ty + 4.4, ty + 8.6, ty + 12.8):
        line(c, tx, yy, tx + tw, yy, HexColor("#DCE4EE"), 0.35)
    text(c, "部門", tx + 2, ty + 3.0, 3.8, "JP-Bold", MUTED)
    text(c, "件数", tx + 16.4, ty + 3.0, 3.8, "JP-Bold", MUTED)
    text(c, "金額", tx + 27.0, ty + 3.0, 3.8, "JP-Bold", MUTED)
    for i, (name, count, val) in enumerate([("外来", "1,248", "47.1M"), ("入院", "2,180", "68.9M"), ("検査", "3,642", "26.9M")]):
        yy = ty + 7.2 + i * 4.2
        text(c, name, tx + 2, yy, 3.6, "JP-Regular", INK)
        text(c, count, tx + 16.2, yy, 3.6, "JP-Regular", INK)
        text(c, val, tx + 27.0, yy, 3.6, "JP-Regular", INK)
    # Tiny bar chart.
    gx, gy = x + 50, y + 31
    line(c, gx, gy + 16, gx + 31, gy + 16, HexColor("#C9D5E3"), 0.5)
    for i, bh in enumerate([6, 8, 10, 12, 15]):
        rect(c, gx + 3 + i * 5.5, gy + 16 - bh, 3.3, bh, CYAN if i < 4 else BLUE)
    text(c, "自動集計で分析時間を確保", gx + 15.5, y + h - 2.6, 4.8, "JP-Medium", NAVY, "center")


def draw_case2(c, x, y, w, h):
    rect(c, x, y, w, h, white, LINE, 2.4)
    rect(c, x + 2.4, y + 2.1, 27, 6.4, GREEN, radius=1.2)
    centered_in(c, "CASE 02 ｜ 申請業務", x + 2.4, y + 2.1, 27, 6.4, 5.5, "JP-Bold", white, 0.15)
    rect(c, x + w - 18, y + 2.1, 15.5, 6.4, HexColor("#FFF1E5"), radius=3)
    centered_in(c, "実績（仮）", x + w - 18, y + 2.1, 15.5, 6.4, 4.8, "JP-Medium", ORANGE, 0.1)

    text(c, "3回入力", x + 7, y + 16.0, 10.3, "JP-Bold", INK)
    text(c, "→", x + 31, y + 16.1, 11.0, "JP-Bold", GREEN)
    text(c, "1回で完了", x + 45, y + 16.0, 10.7, "JP-Bold", GREEN)

    rect(c, x + 4, y + 21, w - 8, h - 25, LIGHT, HexColor("#D9E3EF"), 2)
    text(c, "経費精算申請（画面イメージ）", x + 7, y + 27, 5.2, "JP-Medium", INK)
    # Status steps.
    for i, label in enumerate(["入力", "確認", "完了"]):
        xx = x + 10 + i * 26
        c.setFillColor(GREEN if i == 0 else white)
        c.setStrokeColor(GREEN if i == 0 else HexColor("#BFCBDD"))
        c.circle(X(xx), Y(y + 31.6), X(2.2), fill=1, stroke=1)
        text(c, str(i + 1), xx, y + 32.35, 4.0, "JP-Bold", white if i == 0 else MUTED, "center")
        text(c, label, xx + 4, y + 32.6, 4.0, "JP-Medium", MUTED)
        if i < 2:
            line(c, xx + 10, y + 31.6, xx + 19, y + 31.6, HexColor("#C5D1DF"), 0.5)
    # Form rows.
    for i, (lab, val) in enumerate([("申請日", "2026/09/06"), ("申請者", "サンプル 太郎"), ("内容", "出張に伴う交通費")]):
        yy = y + 36 + i * 4.6
        text(c, lab, x + 8, yy + 2.8, 3.8, "JP-Medium", MUTED)
        rect(c, x + 23, yy, 58, 4, white, HexColor("#D9E2EE"), 0.6)
        text(c, val, x + 25, yy + 2.8, 3.8, "JP-Regular", INK)
    text(c, "入力の手間とミスを削減", x + w / 2, y + h - 2.6, 4.8, "JP-Medium", GREEN, "center")


def draw_proof(c):
    rect(c, 0, 96, 210, 74, LIGHT)
    text(c, "PROOF", 8, 103.2, 5.5, "JP-Bold", BLUE)
    text(c, "変わりはじめた業務", 27, 103.2, 8.6, "JP-Bold", NAVY)
    line(c, 8, 106, 202, 106, HexColor("#AEBFD2"), 0.65)
    draw_case1(c, 8, 109, 94, 53)
    draw_case2(c, 108, 109, 94, 53)
    text(c, "※数値・画面は仮です。正式版では院内の実績2件と実画面に差し替えます。", 105, 166.2, 4.5, "JP-Regular", MUTED, "center")


def route_row(c, x, y, n, label, color, w=73):
    circle_num(c, n, x + 3.2, y - 0.9, color)
    text(c, label, x + 8, y, 6.2, "JP-Medium", INK)
    line(c, x + 8, y + 2.2, x + w, y + 2.2, HexColor("#D7E0EB"), 0.45)


def draw_how(c):
    rect(c, 0, 170, 210, 76, white)
    text(c, "HOW", 8, 177.0, 5.5, "JP-Bold", BLUE)
    text(c, "その先の進め方は2つ。", 24, 177.0, 8.6, "JP-Bold", NAVY)
    line(c, 8, 180, 202, 180, HexColor("#AEBFD2"), 0.65)

    rect(c, 68, 182, 74, 7.6, HexColor("#0757BE"), radius=3.8)
    centered_in(c, "気になる課題について、まず相談", 68, 182, 74, 7.6, 6.6, "JP-Bold", white, 0.2)
    line(c, 105, 189.6, 105, 193.0, BLUE, 0.9)
    line(c, 55, 193.0, 155, 193.0, BLUE, 0.9)
    line(c, 55, 193.0, 55, 195.0, BLUE, 0.9)
    line(c, 155, 193.0, 155, 195.0, GREEN, 0.9)

    # Route 1.
    rect(c, 8, 195, 94, 43.5, HexColor("#F8FBFF"), HexColor("#55A0F2"), 2.4, 0.8)
    people_icon(c, 22, 210, BLUE, 0.75)
    speech_icon(c, 22, 202.8, BLUE, 0.75)
    text(c, "一緒に進める", 33, 203.3, 10.0, "JP-Bold", BLUE)
    text(c, "自分も改善活動に参加したい", 33, 209.2, 5.3, "JP-Medium", MUTED)
    route_row(c, 33, 216, 1, "業務・困りごとを一緒に整理", BLUE, 59)
    route_row(c, 33, 222.1, 2, "原因と改善方法を一緒に考える", BLUE, 59)
    route_row(c, 33, 228.2, 3, "DXチームが技術・実装を支援", BLUE, 59)
    rect(c, 11, 232.3, 88, 4.2, PALE_BLUE, radius=1.2)
    centered_in(c, "試して、一緒に改善　｜　希望があれば実装にも挑戦", 11, 232.3, 88, 4.2, 4.5, "JP-Medium", NAVY_2, 0.1)

    # Route 2.
    rect(c, 108, 195, 94, 43.5, HexColor("#FAFCFA"), HexColor("#72AD88"), 2.4, 0.8)
    clipboard_icon(c, 122, 205, GREEN, 0.78)
    speech_icon(c, 129.5, 211.5, GREEN, 0.65)
    text(c, "課題を共有する", 139, 203.3, 10.0, "JP-Bold", GREEN)
    text(c, "今は一緒に進める時間がない", 139, 209.2, 5.3, "JP-Medium", MUTED)
    route_row(c, 139, 216, 1, "課題の背景や状況を共有", GREEN, 54)
    route_row(c, 139, 222.1, 2, "DXチーム内で整理・検討", GREEN, 54)
    route_row(c, 139, 228.2, 3, "優先順位を踏まえて対応を判断", GREEN, 54)
    rect(c, 111, 232.3, 88, 4.2, PALE_GREEN, radius=1.2)
    centered_in(c, "個別実装を約束するルートではありません", 111, 232.3, 88, 4.2, 4.5, "JP-Medium", GREEN, 0.1)

    text(c, "どちらも入口は相談。違いは、相談後にどのくらい改善活動へ関わるかです。", 105, 243.1, 5.5, "JP-Medium", NAVY, "center")


def draw_footer(c):
    rect(c, 0, 246, 210, 51, NAVY)
    text(c, "WHO", 8, 253.0, 5.3, "JP-Bold", CYAN)
    text(c, "私たちがDXチームです", 23, 253.0, 8.0, "JP-Bold", white)
    rect(c, 75, 248.5, 19, 5.4, HexColor("#173A6A"), radius=2.7)
    centered_in(c, "メンバー仮置き", 75, 248.5, 19, 5.4, 4.1, "JP-Medium", HexColor("#B7D7FA"), 0.1)

    left, right = 8, 146
    chip_gap = 2
    rows = [(5, 258), (4, 267.8), (4, 277.6)]
    index = 1
    for count, yy in rows:
        width = (right - left - chip_gap * (count - 1)) / count
        for col in range(count):
            xx = left + col * (width + chip_gap)
            rect(c, xx, yy, width, 7.3, white, HexColor("#8BA5C6"), 1.3, 0.55)
            text(c, f"{index:02d}", xx + 2.0, yy + 4.9, 4.6, "JP-Bold", BLUE)
            text(c, "氏名／部署", xx + 7.7, yy + 4.9, 4.7, "JP-Medium", NAVY)
            index += 1

    line(c, 151, 255, 151, 288, HexColor("#58779E"), 0.7)
    c.setFillColor(white)
    c.circle(X(162), Y(270.3), X(8.4), fill=1, stroke=0)
    people_icon(c, 162, 273, NAVY_2, 0.72)
    speech_icon(c, 162, 263.5, NAVY_2, 0.68)
    text(c, "気になったら、", 174, 263.7, 7.2, "JP-Bold", white)
    text(c, "この中の誰かに", 174, 272.1, 7.2, "JP-Bold", white)
    text(c, "話しかけてください。", 174, 280.5, 7.2, "JP-Bold", white)
    text(c, "相談だけでも大丈夫です", 174, 287.0, 4.8, "JP-Medium", HexColor("#AFCFF4"))


def build():
    c = canvas.Canvas(str(OUT), pagesize=A4, pageCompression=1)
    c.setTitle("院内DX・業務改善テーマ募集（仮組み）")
    c.setAuthor("DX TEAM")
    draw_top(c)
    draw_benefit(c)
    draw_proof(c)
    draw_how(c)
    draw_footer(c)
    c.showPage()
    c.save()
    print(OUT)


if __name__ == "__main__":
    build()
