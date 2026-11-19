# Makes named.pdf: a book whose chapters have only names in capitals, at body size, at the very top
# of a fresh page (as in many e-book conversions): "FOREWORD", "THE TEST", "NINE YEARS LATER", "THE
# BOY FROM MAKAPU", "HONEST WORK". Running heads repeat the chapter's name on the following pages, and
# a shout in capitals inside the text must not count as a heading.
# Run: python3 make-named-pdf.py
from reportlab.lib.pagesizes import A5
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

W, H = A5
M = 50
FONT, SIZE, LEAD = 'Times-Roman', 11, 15
c = canvas.Canvas(__file__.replace('make-named-pdf.py', 'named.pdf'), pagesize=A5)
y = [H - 40]
head = ['']

def newpage(running=True):
    c.showPage()
    y[0] = H - 40
    if running and head[0]:
        c.setFont(FONT, 8)
        c.drawCentredString(W / 2, H - 25, head[0])
        y[0] = H - 55

def wrap(text, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if stringWidth(t, FONT, SIZE) > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = t
    lines.append(cur)
    return lines

def para(text, indent=True):
    lines = wrap(text, W - 2 * M - (14 if indent else 0))
    for k, line in enumerate(lines):
        if y[0] < 60:
            newpage()
        c.setFont(FONT, SIZE)
        c.drawString(M + (14 if indent and k == 0 else 0), y[0], line)
        y[0] -= LEAD

def chapter(name, n):
    newpage(running=False)
    head[0] = name
    c.setFont(FONT, SIZE)
    c.drawCentredString(W / 2, y[0], name)
    y[0] -= LEAD * 3
    for k in range(n):
        para(f'Paragraph {k + 1} of {name.lower()} goes on for a while, long enough to wrap onto a second line of the page and a third one as well, the way prose does.', indent=k > 0)
        if k == 3:
            para('THINK FAST!”', indent=False)

c.setFont(FONT, 20)
c.drawCentredString(W / 2, H / 2, 'Rise of the Example')
chapter('FOREWORD', 4)
chapter('THE TEST', 14)
chapter('NINE YEARS LATER', 9)
chapter('THE BOY FROM MAKAPU', 16)
chapter('HONEST WORK', 12)
c.save()
