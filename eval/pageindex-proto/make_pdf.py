"""Generate a small deterministic 2-section PDF for the PageIndex smoke test.

Stdlib only. Builds a valid PDF 1.4 file with computed xref offsets.
Run:  python make_pdf.py   ->  probe.pdf
"""
import sys

PAGE_W, PAGE_H = 612, 792
FONT = "/F1"

SECTIONS = [
    {
        "title": "Alpha Protocol",
        "lines": [
            "Alpha Protocol",
            "The Alpha Protocol defines the daily calibration budget of the lab.",
            "Rule A-one: the calibration budget is 42 units per day.",
            "Rule A-two: unused units expire at midnight and never carry over.",
            "Rule A-three: the supervisor of the Alpha Protocol is Dr. Irene Vogel.",
            "Rule A-four: calibration must be logged in the ledger within a day.",
            "The protocol was adopted in 2019 and amended in 2021 and in 2023.",
            "The amendment of 2023 raised the budget from 38 to 42 units per day.",
            "Before the amendment of 2021 the budget was 30 units per day.",
            "Calibration logs are kept for five years under the protocol.",
            "Dr. Irene Vogel signs every quarterly calibration report.",
            "The ledger of the Alpha Protocol lives in the red cabinet.",
        ],
    },
    {
        "title": "Beta Methodology",
        "lines": [
            "Beta Methodology",
            "",
            "The Beta Methodology governs how measurements are reviewed.",
            "Rule B-one: every measurement is reviewed by exactly two reviewers.",
            "Rule B-two: reviewers must not have contributed to the measurement.",
            "Rule B-three: the archive threshold is 500 kilobytes per record.",
            "Rule B-four: the review window is 90 days.",
        ],
    },
    {
        "title": "Gamma Archive",
        "lines": [
            "Gamma Archive",
            "",
            "The Gamma Archive stores every reviewed record permanently.",
            "Rule G-one: archived records are read-only.",
            "Rule G-two: each record keeps a checksum and a reviewer pair.",
            "Rule G-three: retrieval from the archive takes one working day.",
        ],
    },
    {
        "title": "Delta Contacts",
        "lines": [
            "Delta Contacts",
            "",
            "This section lists who to contact for what.",
            "Escalations for the Alpha Protocol go to Dr. Irene Vogel.",
            "Escalations for the Beta Methodology go to the review board.",
            "Escalations for the Gamma Archive go to the archive keeper.",
            "The emergency number is printed in the entrance hall.",
        ],
    },
]


def esc(s: str) -> str:
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def text_ops(lines, y_start=730, lh=16):
    """One section per page: 24pt heading isolated by wide gaps, 11pt body.
    The flash block clusterer needs size + whitespace contrast to keep the
    heading as its own block."""
    out = ["BT"]
    y = y_start
    for i, ln in enumerate(lines):
        if i == 0:  # section heading
            out.append("/F1 24 Tf")
            out.append(f"1 0 0 1 72 {y} Tm")
            out.append(f"({esc(ln)}) Tj")
            y -= 55
        else:
            out.append("/F1 11 Tf")
            out.append(f"1 0 0 1 72 {y} Tm")
            out.append(f"({esc(ln)}) Tj")
            y -= lh
    out.append("ET")
    return "\n".join(out)


def build_pdf() -> bytes:
    objs = {}  # num -> bytes (without "N 0 obj" wrapper)

    def add(num, body: bytes):
        objs[num] = body

    # 1: Catalog, 2: Pages, then per page: page obj + content obj
    pages_ids = []
    for si, sec in enumerate(SECTIONS):
        pid = 3 + si * 2
        cid = pid + 1
        pages_ids.append(pid)
        content = text_ops(sec["lines"]).encode("latin-1")
        add(pid, (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            f"/Resources << /Font << {FONT} 11 0 R >> >> /Contents {cid} 0 R >>"
        ).encode("latin-1"))
        add(cid, b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream")

    add(1, b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{p} 0 R" for p in pages_ids)
    add(2, f"<< /Type /Pages /Kids [{kids}] /Count {len(pages_ids)} >>".encode("latin-1"))
    add(11, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    info = b"<< /Title (PageIndex Smoke Probe) /Producer (eval-proto) >>"
    add(12, info)

    maxnum = max(objs)
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for num in sorted(objs):
        offsets[num] = len(out)
        out += f"{num} 0 obj\n".encode() + objs[num] + b"\nendobj\n"
    xref_pos = len(out)
    out += f"xref\n0 {maxnum + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for num in range(1, maxnum + 1):
        out += f"{offsets[num]:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {maxnum + 1} /Root 1 0 R /Info 12 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n"
    ).encode("latin-1")
    return bytes(out)


if __name__ == "__main__":
    data = build_pdf()
    path = sys.argv[1] if len(sys.argv) > 1 else "probe.pdf"
    with open(path, "wb") as f:
        f.write(data)
    print(f"wrote {path} ({len(data)} bytes)")
