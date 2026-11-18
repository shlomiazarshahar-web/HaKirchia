# Makes source.pdf: a small "original book" for the translation tests (features 12, 28).
# Two chapters over three pages, with a running head, page numbers, indented paragraphs, and one
# paragraph that goes on from page 1 to page 2. Run: python3 make-source-pdf.py
from reportlab.lib.pagesizes import A5
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

W, H = A5
M = 50
FONT, SIZE, LEAD = 'Times-Roman', 11, 15
c = canvas.Canvas(__file__.replace('make-source-pdf.py', 'source.pdf'), pagesize=A5)
page = [1]
y = [H - 90]

def furniture():
    c.setFont('Times-Roman', 8)
    c.drawString(M, H - 40, 'THE SALT ROAD')
    c.drawCentredString(W / 2, 30, str(page[0] + 40))

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

def para(text, indent=18, justify=True):
    ls = lines_of(text, indent)
    for i, l in enumerate(ls):
        if y[0] < 60:
            newpage()
        c.setFont(FONT, SIZE)
        x = M + (indent if i == 0 else 0)
        last = i == len(ls) - 1
        if justify and not last:
            # spread the words to the right margin, like a printed book
            ws = l.split()
            gap = (W - M - x - sum(stringWidth(w, FONT, SIZE) for w in ws)) / max(1, len(ws) - 1)
            for w in ws:
                c.drawString(x, y[0], w)
                x += stringWidth(w, FONT, SIZE) + gap
        else:
            c.drawString(x, y[0], l)
        y[0] -= LEAD

def heading(text):
    if y[0] < 120:
        newpage()
    y[0] -= 10
    c.setFont('Times-Italic', 18)
    c.drawCentredString(W / 2, y[0], text)
    y[0] -= 34

furniture()
heading('III. The Crossing')
para('They left the village before the bells, when the road was still blue with night. Miriam carried the lamp; her brother carried nothing but his silence.', indent=0)
para('By the third mile the salt flats opened on either side, white and unbroken, and the wind came off them with a sound like paper being torn very slowly.')
para('"Don\'t look back," their father had said. It was the only advice he had ever given them, and they had already broken it twice.')
para('At noon they reached the well. The bucket was gone, the rope cut clean, and someone had written a single word on the stone in charcoal.')
para('Miriam read it aloud, though she knew her brother could read it too. Some words, she thought, need to be heard before they can be believed. She read it again, slower, and the wind took the sound of it out across the flats and did not bring it back, and for a long while neither of them said anything at all, because there was nothing in the world that could be said after a word like that one had been read aloud twice in the middle of an empty road.')
para('They slept that night in the lee of a broken wall. The stars came out all at once, as if someone had lifted a cloth from a table of silver.')
para('In the morning her brother spoke for the first time since the village. "The word on the well," he said. "It was our name."')
heading('IV. The Other Road')
para('Nobody in the next town had heard of the well, or of the word, or of them.', indent=0)
para('Miriam asked at the inn and at the market, and each time the answer was the same shrug, the same look at the lamp she still carried in daylight.')
c.showPage()
c.save()
