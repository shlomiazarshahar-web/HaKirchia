# Makes structure.pdf: an "original book" for finding chapters and scene breaks (round 6).
# A title page, then chapters whose headings look different ("Chapter One" + its name on two lines,
# "CHAPTER 2", a roman numeral alone), scene breaks drawn as "* * *", as a single "*", and as a small
# ornament picture between paragraphs, plus a running head and page numbers on every page.
# Run: python3 make-structure-pdf.py
import io
from reportlab.lib.pagesizes import A5
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth
from PIL import Image, ImageDraw

W, H = A5
M = 50
FONT, SIZE, LEAD = 'Times-Roman', 11, 15
c = canvas.Canvas(__file__.replace('make-structure-pdf.py', 'structure.pdf'), pagesize=A5)
page = [1]
y = [H - 90]

orn = Image.new('RGB', (120, 24), 'white')
d = ImageDraw.Draw(orn)
d.ellipse((50, 4, 70, 20), outline='black', width=2)
d.line((10, 12, 45, 12), fill='black', width=2)
d.line((75, 12, 110, 12), fill='black', width=2)
buf = io.BytesIO()
orn.save(buf, 'PNG')
ORN = ImageReader(io.BytesIO(buf.getvalue()))

def furniture():
    if page[0] == 1:
        return
    c.setFont('Times-Roman', 8)
    c.drawString(M, H - 40, 'THE SALT ROAD')
    c.drawCentredString(W / 2, 30, str(page[0]))

def newpage():
    c.showPage()
    page[0] += 1
    y[0] = H - 90
    furniture()

def lines_of(text, first_indent):
    words, out, cur, width = text.split(), [], '', W - 2 * M
    for w in words:
        trial = (cur + ' ' + w).strip()
        avail = width - (first_indent if not out else 0)
        if stringWidth(trial, FONT, SIZE) > avail and cur:
            out.append(cur)
            cur = w
        else:
            cur = trial
    if cur:
        out.append(cur)
    return out

def para(text, indent=18):
    ls = lines_of(text, indent)
    for i, l in enumerate(ls):
        if y[0] < 60:
            newpage()
        c.setFont(FONT, SIZE)
        c.drawString(M + (indent if i == 0 else 0), y[0], l)
        y[0] -= LEAD

def centered(text, size=11, font=FONT, gap=LEAD * 2):
    y[0] -= gap / 2
    c.setFont(font, size)
    c.drawCentredString(W / 2, y[0], text)
    y[0] -= gap / 2 + LEAD

def ornament():
    y[0] -= 12
    c.drawImage(ORN, W / 2 - 30, y[0] - 6, width=60, height=12)
    y[0] -= 26

def chapter(*lines):
    newpage()
    y[0] = H - 170  # chapters start lower on the page
    for l in lines:
        c.setFont('Times-Bold', 20)
        c.drawCentredString(W / 2, y[0], l)
        y[0] -= 30
    y[0] -= 20

LONG = 'The wind came off the flats with a sound like paper being torn very slowly, and nobody spoke for a long time.'

# title page
c.setFont('Times-Bold', 28)
c.drawCentredString(W / 2, H / 2 + 40, 'THE SALT ROAD')
c.setFont('Times-Roman', 14)
c.drawCentredString(W / 2, H / 2, 'a novel')

chapter('Chapter One', 'The Crossing')
para('They left the village before the bells, when the road was still blue with night. ' + LONG, indent=0)
para('By the third mile the salt flats opened on either side, white and unbroken. ' + LONG)
centered('* * *')
para('At noon they reached the well. The bucket was gone, the rope cut clean. ' + LONG, indent=0)
para('Miriam read the word aloud, though she knew her brother could read it too. ' + LONG)
centered('*')
para('They slept that night in the lee of a broken wall. ' + LONG, indent=0)
ornament()
para('In the morning her brother spoke for the first time since the village. ' + LONG, indent=0)

chapter('CHAPTER 2')
para('Nobody in the next town had heard of the well, or of the word, or of them. ' + LONG, indent=0)
para('Miriam asked at the inn and at the market, and each time the answer was the same. ' + LONG)

chapter('III')
para('The road turned south after the town, toward the hills nobody named. ' + LONG, indent=0)
para('By evening the hills had names after all, written on the stones in charcoal. ' + LONG)
c.showPage()
c.save()
