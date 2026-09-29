"""Deterministic T1 corpus generator - eval/docling-proto/corpus.

Run:  .venv/Scripts/python.exe corpus/generate_corpus.py [--out DIR]
Writes 8 synthetic-authored PDFs + manifest.json. Byte-identical across runs:
reportlab invariant=1, fixed fonts/content, no RNG. Two-column fixtures are
EMITTED line-interleaved (left line, right line, ...) like print pipelines
commonly do - that is the reading-order challenge for extractors.

Ground truth lives in manifest.json: expected phrases per page, table cells
with dims, reading-order sentinels, scan docs flagged ocrOnly, and for
single-column docs the ordered reference paragraphs (char-level similarity).
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.colors import black
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Table, TableStyle

PAGE_W, PAGE_H = A4
MARGIN = 56.0
COL_GAP = 24.0
BODY = "Helvetica"
BODY_B = "Helvetica-Bold"
SIZE, LEAD = 10.5, 15.0
ARIAL = "C:/Windows/Fonts/arial.ttf"
DPI = 150
SCALE = DPI / 72.0
IMG_W, IMG_H = int(PAGE_W * SCALE), int(PAGE_H * SCALE)

manifest = {"created_by": "generate_corpus.py (reportlab invariant=1, fixed content)", "docs": []}


def wrap(text, font, size, maxw):
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if stringWidth(t, font, size) <= maxw:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def para(canvas, x, y, w, text, font=BODY, size=SIZE, lead=LEAD):
    canvas.setFont(font, size)
    for line in wrap(text, font, size, w):
        canvas.drawString(x, y, line)
        y -= lead
    return y


def heading(canvas, x, y, text, size=15):
    canvas.setFont(BODY_B, size)
    canvas.drawString(x, y, text)
    return y - size - 12


def title(canvas, y, text):
    canvas.setFont(BODY_B, 18)
    canvas.drawString(MARGIN, y, text)
    return y - 30


def footer(canvas, page_no):
    canvas.setFont(BODY, 8)
    canvas.drawString(MARGIN, 24, f"Seite {page_no}")
    canvas.drawRightString(PAGE_W - MARGIN, 24, "T1-Korpus (synthetisch)")


def new_doc(doc_id, file_name, pages, klass, **extra):
    entry = {"docId": doc_id, "fileName": file_name, "pages": pages, "class": klass}
    entry.update(extra)
    manifest["docs"].append(entry)


def phrases(entry, *items):
    entry.setdefault("expectedPhrases", []).extend(
        {"text": t, "page": p} for (t, p) in items
    )


# ---------------------------------------------------------------- scan pages
def render_scan_image(lines):
    img = Image.new("RGB", (IMG_W, IMG_H), "white")
    d = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(ARIAL, 42)
    f_body = ImageFont.truetype(ARIAL, 27)
    y = 110
    for kind, text in lines:
        f = f_title if kind == "t" else f_body
        d.text((100, y), text, font=f, fill="black")
        y += int(f.size * 1.75)
    return img


def image_page(canvas, img, page_no):
    # image-only page: no text operators at all (that is the point of the
    # scan-like fixture) - so no footer text either
    canvas.drawImage(ImageReader(img), 0, 0, PAGE_W, PAGE_H)


# --------------------------------------------------------------- doc builders
def build_sc1(canvas, entry):
    # 3 pages, single column
    y = title(canvas, PAGE_H - 70, "Hafenlogbuch Nordkai 7")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Dieses Logbuch fasst den Betrieb des Frachtkais Nordkai 7 im ersten Quartal "
             "zusammen und ist die Grundlage für die Abstimmung mit der Hafenverwaltung. "
             "Alle Angaben beziehen sich auf die Schichten vom 1. Januar bis 31. März.")
    y = heading(canvas, MARGIN, y - 8, "Betrieb im März")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Die beiden mobilen Kräne an der Nordmole liefen im März im Zweischichtbetrieb "
             "und hoben zusammen 4 120 Tonnen Stückgut. Die mittlere Wartezeit vor dem Kai "
             "lag bei 38 Minuten, ein Viertel unter dem Vorquartal.")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Am Kai 7a wurde der alte Werftkran außer Betrieb genommen. Sein Ersatzkran "
             "trifft Mitte April an und wird zunächst nur im Tagdienst eingesetzt.")
    footer(canvas, 1)

    canvas.showPage()
    y = heading(canvas, MARGIN, PAGE_H - 70, "Personaleinsatz")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Der Planungenstermin der Frühjahrssaison sieht 42 Vollzeitkräfte und 9 "
             "Zeitarbeitskräfte vor. Krankenstand und Urlaub klaffen auseinander: "
             "Der Krankenstand sank auf 3,1 Prozent, während die Urlaubsreserve auf 210 "
             "Tage anwuchs.")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Für die Nachtshift werden zwei weitere Staplerfahrer qualifiziert. Die "
             "Unterweisung nach Schriftwechsel mit der Berufsgenossenschaft ist für den "
             "8. April terminiert.")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Der Betriebsrat wurde über die Verschiebung der Frühschicht informiert und "
             "hat keinen Einspruch eingelegt. Die neue Schichtverteilung gilt ab dem 15. April.")
    footer(canvas, 2)

    canvas.showPage()
    y = heading(canvas, MARGIN, PAGE_H - 70, "Auflagen und Fristen")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Die Staubmessung an der Kaimauer muss bis 30. April nachgereicht werden. "
             "Fehlende Messwerte aus Woche 11 werden vom Institut für Umweltanalytik "
             "nachgeliefert. Der Nachtrag geht direkt an die Hafenverwaltung.")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Bis zur nächsten Begehung am 12. Mai sind die Ringanker am Schuppen D zu "
             "prüfen und das Ergebnis ins Logbuch einzutragen. Ohne Eintrag gilt die "
             "Prüfung als nicht erfolgt.")
    footer(canvas, 3)

    phrases(entry,
            ("Grundlage für die Abstimmung mit der Hafenverwaltung", 1),
            ("mobilen Kräne an der Nordmole liefen im März im Zweischichtbetrieb", 1),
            ("mittlere Wartezeit vor dem Kai lag bei 38 Minuten", 1),
            ("Werftkran außer Betrieb genommen", 1),
            ("Krankenstand sank auf 3,1 Prozent", 2),
            ("Nachtshift werden zwei weitere Staplerfahrer qualifiziert", 2),
            ("Betriebsrat wurde über die Verschiebung der Frühschicht informiert", 2),
            ("Staubmessung an der Kaimauer muss bis 30. April nachgereicht", 3),
            ("Ringanker am Schuppen D zu prüfen", 3))
    entry["referenceParas"] = [
        "Hafenlogbuch Nordkai 7",
        "Dieses Logbuch fasst den Betrieb des Frachtkais Nordkai 7 im ersten Quartal zusammen und ist die Grundlage für die Abstimmung mit der Hafenverwaltung. Alle Angaben beziehen sich auf die Schichten vom 1. Januar bis 31. März.",
        "Betrieb im März",
        "Die beiden mobilen Kräne an der Nordmole liefen im März im Zweischichtbetrieb und hoben zusammen 4 120 Tonnen Stückgut. Die mittlere Wartezeit vor dem Kai lag bei 38 Minuten, ein Viertel unter dem Vorquartal.",
        "Am Kai 7a wurde der alte Werftkran außer Betrieb genommen. Sein Ersatzkran trifft Mitte April an und wird zunächst nur im Tagdienst eingesetzt.",
        "Personaleinsatz",
        "Der Planungenstermin der Frühjahrssaison sieht 42 Vollzeitkräfte und 9 Zeitarbeitskräfte vor. Krankenstand und Urlaub klaffen auseinander: Der Krankenstand sank auf 3,1 Prozent, während die Urlaubsreserve auf 210 Tage anwuchs.",
        "Für die Nachtshift werden zwei weitere Staplerfahrer qualifiziert. Die Unterweisung nach Schriftwechsel mit der Berufsgenossenschaft ist für den 8. April terminiert.",
        "Der Betriebsrat wurde über die Verschiebung der Frühschicht informiert und hat keinen Einspruch eingelegt. Die neue Schichtverteilung gilt ab dem 15. April.",
        "Auflagen und Fristen",
        "Die Staubmessung an der Kaimauer muss bis 30. April nachgereicht werden. Fehlende Messwerte aus Woche 11 werden vom Institut für Umweltanalytik nachgeliefert. Der Nachtrag geht direkt an die Hafenverwaltung.",
        "Bis zur nächsten Begehung am 12. Mai sind die Ringanker am Schuppen D zu prüfen und das Ergebnis ins Logbuch einzutragen. Ohne Eintrag gilt die Prüfung als nicht erfolgt.",
    ]


def build_sc2(canvas, entry):
    # 2 pages, single column
    y = title(canvas, PAGE_H - 70, "Notiz zum Observatoriumsausbau")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Vorgeschlagen wird, das Nebengebäude des Observatoriums zu einem "
             "Arbeitsraum für die Fotoplatten-Sammlung umzubauen. Der Raum bietet "
             "konstante 18 Grad und eine Luftfeuchte um 45 Prozent.")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Die Plattenkataloge von 1911 bis 1974 liegen in sieben Schränken. Für die "
             "Verkartung fehlt bisher eine feste Finanzierung; ein Antrag beim Fonds für "
             "Regionalkultur ist vorbereitet.")
    footer(canvas, 1)

    canvas.showPage()
    y = heading(canvas, MARGIN, PAGE_H - 70, "Risiken und nächste Schritte")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Hauptrisiko bleibt die Bausubstanz des Daches. Eine Statikprüfung im "
             "Februar ergab Tragreserven, aber Risse im Mauerwerk des Südflügels sind "
             "nicht abschließend bewertet.")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Als nächster Schritt ist eine Begehung mit dem Denkmalamt am 3. Juni "
             "vereinbart. Danach entscheidet der Träger über den Antrag.")
    footer(canvas, 2)

    phrases(entry,
            ("konstante 18 Grad und eine Luftfeuchte um 45 Prozent", 1),
            ("Plattenkataloge von 1911 bis 1974 liegen in sieben Schränken", 1),
            ("Antrag beim Fonds für Regionalkultur ist vorbereitet", 1),
            ("Statikprüfung im Februar ergab Tragreserven", 2),
            ("Begehung mit dem Denkmalamt am 3. Juni vereinbart", 2))
    entry["referenceParas"] = [
        "Notiz zum Observatoriumsausbau",
        "Vorgeschlagen wird, das Nebengebäude des Observatoriums zu einem Arbeitsraum für die Fotoplatten-Sammlung umzubauen. Der Raum bietet konstante 18 Grad und eine Luftfeuchte um 45 Prozent.",
        "Die Plattenkataloge von 1911 bis 1974 liegen in sieben Schränken. Für die Digitalisierung fehlt bisher eine feste Finanzierung; ein Antrag beim Fonds für Regionalkultur ist vorbereitet.",
        "Risiken und nächste Schritte",
        "Hauptrisiko bleibt die Bausubstanz des Daches. Eine Statikprüfung im Februar ergab Tragreserven, aber Risse im Mauerwerk des Südflügels sind nicht abschließend bewertet.",
        "Als nächster Schritt ist eine Begehung mit dem Denkmalamt am 3. Juni vereinbart. Danach entscheidet der Träger über den Antrag.",
    ]


def two_col_paras(prefix):
    """6 paragraphs per column, unique sentinel token per paragraph. The two
    columns flow INDEPENDENTLY (different paragraph lengths -> misaligned
    baselines), as in real two-column documents."""
    left, right = [], []
    for i in range(1, 7):
        left.append(
            f"{prefix}L{i} Die Tagesordnung des Ausschusses beginnt mit dem Bauunterhalt "
            f"der Halle {i}. Der Bauunterhalt beansprucht den größten Teil des Budgets "
            f"für das kommende Jahr, weil Dachentwässerung und Torantriebe gleichzeitig "
            f"saniert werden. Zwei Anträge zur Halle {i} sind nachgetragen."
        )
        right.append(
            f"{prefix}R{i} Im Veranstaltungskalender stehen {i} Termine mit je etwa "
            f"120 Gästen. Der Dienstplan für die Bewirtung wird eng getaktet."
        )
    return left, right


def draw_justified_line(canvas, x, y, line, width, font=BODY, size=SIZE, last=False):
    """Justified line: stretch word spacing so the line ends exactly at
    x+width (print-style two-column text). Last line of a paragraph stays
    ragged."""
    canvas.setFont(font, size)
    if last or " " not in line:
        canvas.drawString(x, y, line)
        return
    words = line.split()
    gap = (width - stringWidth(line, font, size)) / (len(words) - 1)
    t = canvas.beginText(x, y)
    t.setFont(font, size)
    t.setWordSpace(gap)
    t.textOut(line)
    canvas.drawText(t)


def build_two_col(canvas, entry, heading_text, prefix, page_no):
    left, right = two_col_paras(prefix)
    y = title(canvas, PAGE_H - 70, heading_text)
    colw = (PAGE_W - 2 * MARGIN - COL_GAP) / 2
    lx, rx = MARGIN, MARGIN + colw + COL_GAP
    ll, rl = [], []
    for p in left:
        lines = wrap(p, BODY, SIZE, colw)
        ll.extend((l, j == len(lines) - 1) for j, l in enumerate(lines))
        ll.append(("", True))
    for p in right:
        lines = wrap(p, BODY, SIZE, colw)
        rl.extend((l, j == len(lines) - 1) for j, l in enumerate(lines))
        rl.append(("", True))
    yy = y - 24
    for i in range(max(len(ll), len(rl))):
        if i < len(ll) and ll[i][0]:
            draw_justified_line(canvas, lx, yy, ll[i][0], colw, last=ll[i][1])
        if i < len(rl) and rl[i][0]:
            draw_justified_line(canvas, rx, yy, rl[i][0], colw, last=rl[i][1])
        yy -= LEAD
    footer(canvas, page_no)
    return left, right


def build_tc1(canvas, entry):
    left1, right1 = build_two_col(canvas, entry, "Wochenbericht Kai-West", "WQ", 1)
    canvas.showPage()
    left2, right2 = build_two_col(canvas, entry, "Wochenbericht Kai-West, Fortsetzung", "WX", 2)
    left = left1 + left2
    right = right1 + right2
    entry["readingOrder"] = {
        "left": [p.split()[0] for p in left],
        "right": [p.split()[0] for p in right],
    }
    entry["expectedPhrases"] = (
        [{"text": f"{t} Die Tagesordnung", "page": 1 if i < 6 else 2}
         for i, t in enumerate([p.split()[0] for p in left])]
        + [{"text": f"{t} Im Veranstaltungskalender", "page": 1 if i < 6 else 2}
           for i, t in enumerate([p.split()[0] for p in right])]
    )


def build_tc2(canvas, entry):
    left1, right1 = build_two_col(canvas, entry, "Marktanalyse Kleingärten", "MK", 1)
    canvas.showPage()
    left2, right2 = build_two_col(canvas, entry, "Marktanalyse Kleingärten, Teil 2", "MY", 2)
    left = left1 + left2
    right = right1 + right2
    entry["readingOrder"] = {
        "left": [p.split()[0] for p in left],
        "right": [p.split()[0] for p in right],
    }
    entry["expectedPhrases"] = (
        [{"text": f"{t} Die Tagesordnung", "page": 1 if i < 6 else 2}
         for i, t in enumerate([p.split()[0] for p in left])]
        + [{"text": f"{t} Im Veranstaltungskalender", "page": 1 if i < 6 else 2}
           for i, t in enumerate([p.split()[0] for p in right])]
    )


TABLE_STYLE = TableStyle([
    ("FONT", (0, 0), (-1, 0), BODY_B, 10),
    ("FONT", (0, 1), (-1, -1), BODY, 10),
    ("GRID", (0, 0), (-1, -1), 0.5, black),
    ("BACKGROUND", (0, 0), (-1, 0), (0.92, 0.92, 0.92)),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
])


def draw_table(canvas, data, col_widths, x, y_top):
    t = Table(data, colWidths=col_widths, style=TABLE_STYLE)
    w, h = t.wrapOn(canvas, PAGE_W - 2 * MARGIN, PAGE_H)
    t.drawOn(canvas, x, y_top - h)
    return y_top - h - 20


T1_MAIN = [
    ["Kennung", "Schwelle", "Einheit", "Stand"],
    ["FR-101", "12,5", "kW", "2026-03-14"],
    ["FR-118", "0,42", "EUR/kWh", "2026-03-17"],
    ["FR-204", "148", "m3/h", "2026-03-19"],
    ["FR-311", "3,7", "t/Tag", "2026-03-21"],
    ["FR-402", "91", "%", "2026-03-24"],
]
T1_SMALL = [
    ["Zone", "Status", "Datum"],
    ["Schuppen D", "geprüft", "2026-03-11"],
    ["Nordmole", "offen", "2026-03-25"],
]
T2_MAIN = [
    ["Messung", "Wert", "Einheit", "Toleranz", "Status"],
    ["M-01 Durchfluss", "0,418", "m3/s", "0,010", "gültig"],
    ["M-02 Druck", "2,34", "bar", "0,05", "gültig"],
    ["M-03 Temperatur", "17,9", "°C", "0,4", "geprüft"],
    ["M-04 Dichte", "1,027", "kg/l", "0,002", "geprüft"],
    ["M-05 Viskosität", "1,86", "mPa·s", "0,03", "vorläufig"],
    ["M-06 Leitfähigkeit", "612", "µS/cm", "8", "vorläufig"],
    ["M-07 pH-Wert", "7,32", "-", "0,05", "abgelehnt"],
]


def build_tb1(canvas, entry):
    y = title(canvas, PAGE_H - 70, "Lieferschwellen Bericht Q1")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Die Tabelle auf der nächsten Seite listet die vereinbarten Lieferschwellen "
             "für das erste Quartal. Kennungen verweisen auf die Rahmenverträge der "
             "Hafenspedition. Auffällig ist die Streuung bei den Energiepreisen.")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Nachträge werden nur wirksam, wenn Schwelle und Einheit beide bestätigt "
             "sind. Der Stand gibt das Datum der letzten Bestätigung wieder.")
    footer(canvas, 1)

    canvas.showPage()
    y = title(canvas, PAGE_H - 70, "Haupttabelle: Schwellen")
    y = draw_table(canvas, T1_MAIN, [90, 200, 100, 100], MARGIN, y)
    phrases(entry, *[(" ".join(row), 2) for row in T1_MAIN[1:4]])
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Die Werte für FR-204 und FR-311 liegen im erwarteten Band. Eine "
             "Nachverhandlung zu FR-118 ist für April angesetzt.")
    footer(canvas, 2)

    canvas.showPage()
    y = title(canvas, PAGE_H - 70, "Nachtrag: Zonenstatus")
    y = draw_table(canvas, T1_SMALL, [160, 120, 120], MARGIN, y)
    phrases(entry, ("Nordmole offen 2026-03-25", 3),
            ("Schuppen D geprüft 2026-03-11", 3))
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Für die offene Zone Nordmole wird eine Begehung im April vorgesehen.")
    footer(canvas, 3)

    entry["tables"] = [
        {"page": 2, "rows": 6, "cols": 4, "cells": T1_MAIN},
        {"page": 3, "rows": 3, "cols": 3, "cells": T1_SMALL},
    ]


def build_tb2(canvas, entry):
    y = title(canvas, PAGE_H - 70, "Messreihe Pumpwerk 4")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Die Messreihe vom 18. März erfasst sieben Kenngrößen des Pumpwerks 4. "
             "Alle Werte wurden im Labor des Wasserzweckverbands bestimmt; die "
             "Toleranzen stammen aus den zugehörigen Prüfblättern.")
    footer(canvas, 1)

    canvas.showPage()
    y = title(canvas, PAGE_H - 70, "Messwerte im Detail")
    y = draw_table(canvas, T2_MAIN, [150, 80, 80, 80, 90], MARGIN, y)
    phrases(entry, *[(" ".join(row), 2) for row in T2_MAIN[1:]])
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Der abgelehnte pH-Wert wird am 2. April wiederholt. Alle übrigen Messungen "
             "gehen unverändert in den Quartalsbericht ein.")
    footer(canvas, 2)

    entry["tables"] = [{"page": 2, "rows": 8, "cols": 5, "cells": T2_MAIN}]


SN1_P1 = [
    ("t", "Versandliste KW 38"),
    ("b", "Ausgangslager Halle B, Ausgang 16:40 Uhr"),
    ("b", "Pos 01  Artikel VL-2043  Menge 24 Stück"),
    ("b", "Pos 02  Artikel VL-2098  Menge 12 Stück"),
    ("b", "Pos 03  Artikel RM-1170  Menge 60 Stück"),
    ("b", "Pos 04  Artikel RM-1172  Menge 8 Stück"),
    ("b", "Pos 05  Artikel TB-3301  Menge 36 Stück"),
    ("b", "Pos 06  Artikel TB-3355  Menge 18 Stück"),
    ("b", "Pos 07  Artikel HD-0114  Menge 90 Stück"),
    ("b", "Pos 08  Artikel HD-0188  Menge 45 Stück"),
    ("b", "Kontrolle: Ladehof 2, Rampe 7, Beifahrer T. Wand"),
]
SN1_P2 = [
    ("t", "Versandliste KW 38, Teil 2"),
    ("b", "Ziellager Erfurt, Inbound 17:05 Uhr"),
    ("b", "Pos 09  Artikel GS-2201  Menge 30 Stück"),
    ("b", "Pos 10  Artikel GS-2244  Menge 15 Stück"),
    ("b", "Pos 11  Artikel KL-0091  Menge 72 Stück"),
    ("b", "Pos 12  Artikel KL-0104  Menge 6 Stück"),
    ("b", "Begleitpapiere: 2 Frachtbriefe, 1 Gefahrgutdeklaration"),
    ("b", "Abnahme durch: M. Behrend, Unterschrift erfolgt"),
    ("b", "Rückfrage: Disposition Durchwahl 417"),
]


def build_sn1(canvas, entry):
    image_page(canvas, render_scan_image(SN1_P1), 1)
    canvas.showPage()
    image_page(canvas, render_scan_image(SN1_P2), 2)
    entry["ocrOnly"] = True
    phrases(entry,
            ("Versandliste KW 38", 1),
            ("Artikel VL-2043", 1),
            ("Artikel RM-1170", 1),
            ("Artikel TB-3301", 1),
            ("Artikel HD-0114", 1),
            ("Ladehof 2, Rampe 7", 1),
            ("Versandliste KW 38, Teil 2", 2),
            ("Artikel GS-2201", 2),
            ("Artikel KL-0091", 2),
            ("Gefahrgutdeklaration", 2),
            ("Disposition Durchwahl", 2))


def render_chart_image():
    img = Image.new("RGB", (IMG_W, IMG_H), "white")
    d = ImageDraw.Draw(img)
    f_title = ImageFont.truetype(ARIAL, 52)
    f_lab = ImageFont.truetype(ARIAL, 40)
    d.text((280, 120), "Kostenübersicht Q3", font=f_title, fill="black")
    base = 1400
    bars = [("Planung 42", 320, (120, 120, 120)),
            ("Bau 118", 900, (60, 60, 60)),
            ("Prüfung 17", 130, (120, 120, 120)),
            ("Rücklage 9", 70, (120, 120, 120))]
    x = 260
    for label, h, color in bars:
        d.rectangle([x, base - h, x + 240, base], outline="black", fill=color)
        d.text((x - 20, base + 40), label, font=f_lab, fill="black")
        x += 420
    d.line([200, base, IMG_W - 200, base], fill="black", width=4)
    d.text((520, base + 160), "alle Werte in Tsd. EUR", font=f_lab, fill="black")
    return img


def build_mx1(canvas, entry):
    # page 1: text
    y = title(canvas, PAGE_H - 70, "Projektbrief Hallenneubau")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Der Neubau der Halle 3 startet mit Verzug von zwei Wochen. Grund ist die "
             "späte Freigabe der Baugrube durch die Stadt. Der Endtermin bleibt bei "
             "November, der Puffer schrumpft auf drei Wochen.")
    y = para(canvas, MARGIN, y, PAGE_W - 2 * MARGIN,
             "Die Budgetlage ist stabil. Details stehen in der Tabelle auf Seite 2, die "
             "Kostenverteilung zeigt die Grafik auf Seite 3.")
    footer(canvas, 1)
    phrases(entry,
            ("Verzug von zwei Wochen", 1),
            ("Endtermin bleibt bei November", 1),
            ("Budgetlage ist stabil", 1))

    # page 2: table
    data = [
        ["Posten", "Plan", "Ist", "Rest"],
        ["Rohbau", "612", "598", "14"],
        ["Technik", "240", "231", "9"],
        ["Innenausbau", "180", "0", "180"],
        ["Rücklage", "60", "0", "60"],
    ]
    canvas.showPage()
    y = title(canvas, PAGE_H - 70, "Budgetposten (Tsd. EUR)")
    draw_table(canvas, data, [160, 90, 90, 90], MARGIN, y)
    phrases(entry, *[(" ".join(row), 2) for row in data[1:]])
    footer(canvas, 2)

    # page 3: image only
    canvas.showPage()
    image_page(canvas, render_chart_image(), 3)
    entry["ocrOnlyPages"] = [3]
    entry["expectedPhrases"] += [
        {"text": "Kostenübersicht Q3", "page": 3},
        {"text": "Planung 42", "page": 3},
        {"text": "Bau 118", "page": 3},
        {"text": "Prüfung 17", "page": 3},
        {"text": "alle Werte in Tsd. EUR", "page": 3},
    ]
    entry["tables"] = [{"page": 2, "rows": 5, "cols": 4, "cells": data}]


BUILDERS = [
    ("sc-hafen-logbuch.pdf", "sc-hafen-logbuch", 3, "single-column", build_sc1),
    ("sc-observatorium-notiz.pdf", "sc-observatorium-notiz", 2, "single-column", build_sc2),
    ("tc-wochenbericht.pdf", "tc-wochenbericht", 2, "two-column", build_tc1),
    ("tc-marktanalyse.pdf", "tc-marktanalyse", 2, "two-column", build_tc2),
    ("tb-lieferschwelle.pdf", "tb-lieferschwelle", 3, "table", build_tb1),
    ("tb-messreihe.pdf", "tb-messreihe", 2, "table", build_tb2),
    ("sn-versandliste.pdf", "sn-versandliste", 2, "scan-ocr", build_sn1),
    ("mx-projektbrief.pdf", "mx-projektbrief", 3, "mixed", build_mx1),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    for file_name, doc_id, pages, klass, builder in BUILDERS:
        entry = {"docId": doc_id, "fileName": file_name, "pages": pages, "class": klass}
        path = out / file_name
        canvas = Canvas(str(path), pagesize=A4, invariant=1)
        canvas.setTitle(doc_id)
        builder(canvas, entry)
        canvas.save()
        manifest["docs"].append(entry)

    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), "utf-8")
    print(f"wrote {len(BUILDERS)} PDFs + manifest.json to {out}")


if __name__ == "__main__":
    main()
